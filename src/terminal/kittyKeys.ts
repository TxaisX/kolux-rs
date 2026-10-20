// TERM-082 / VIEW-109 / TERM-086 (T-306): the enhanced ("progressive enhancement", kitty) keyboard protocol, from its
// public spec at https://sw.kovidgoyal.net/kitty/keyboard-protocol/ . A program turns it on by pushing or setting
// flags (CSI > flags u, CSI = flags ; mode u), turns it off by popping (CSI < n u) and asks with CSI ? u; the main and
// alternate screens keep their own stacks. Only while the active screen's flags are non-zero are keys encoded here;
// otherwise the pane keeps xterm's legacy encoding. Dead keys and input-method keys are never encoded, so accented
// characters still compose; Kolux's own chords are routed before this runs (shellKeys.ts), so they are never sent.
// Pure: the pane feeds it the CSI parameters and the key events and writes what comes back.

/** The flag bits of the spec's progressive enhancement table. */
export const KITTY = { disambiguate: 1, eventTypes: 2, alternateKeys: 4, allAsEscapes: 8, associatedText: 16 } as const;
/** How many pushed entries a screen keeps; a push past this evicts the oldest (the spec's overflow rule). */
export const KITTY_STACK_CAP = 16;
const ALL_FLAGS = 31;

type Screen = { base: number; stack: number[] };
const blank = (): Screen => ({ base: 0, stack: [] });

/** A key event as the pane hands it over (a DOM KeyboardEvent fits). */
export type KittyKey = {
  type: string;
  key: string;
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  /** Windows AltGr arrives as Ctrl+Alt; when the layout says AltGraph the key types a character instead. */
  altGraph?: boolean;
  capsLock?: boolean;
  numLock?: boolean;
};

/** Keys that have their own number in the spec: [number, final]. "u" keys use CSI n u, the rest CSI n ~ or CSI 1 X. */
const FUNCTIONAL: Record<string, [number, string]> = {
  Escape: [27, "u"], Enter: [13, "u"], Tab: [9, "u"], Backspace: [127, "u"],
  Insert: [2, "~"], Delete: [3, "~"], PageUp: [5, "~"], PageDown: [6, "~"],
  ArrowLeft: [1, "D"], ArrowRight: [1, "C"], ArrowUp: [1, "A"], ArrowDown: [1, "B"], Home: [1, "H"], End: [1, "F"],
  F1: [1, "P"], F2: [1, "Q"], F3: [13, "~"], F4: [1, "S"], F5: [15, "~"], F6: [17, "~"], F7: [18, "~"], F8: [19, "~"],
  F9: [20, "~"], F10: [21, "~"], F11: [23, "~"], F12: [24, "~"],
  CapsLock: [57358, "u"], ScrollLock: [57359, "u"], NumLock: [57360, "u"], PrintScreen: [57361, "u"], Pause: [57362, "u"], ContextMenu: [57363, "u"],
};
for (let n = 13; n <= 24; n++) FUNCTIONAL[`F${n}`] = [57376 + n - 13, "u"];

/** Keypad keys (by physical code), reported with their own numbers only when every key is an escape code. */
const KEYPAD: Record<string, number> = { NumpadDecimal: 57409, NumpadDivide: 57410, NumpadMultiply: 57411, NumpadSubtract: 57412, NumpadAdd: 57413, NumpadEnter: 57414, NumpadEqual: 57415 };
for (let n = 0; n <= 9; n++) KEYPAD[`Numpad${n}`] = 57399 + n;

/** Modifier keys themselves (left and right apart), reported only when every key is an escape code. */
const MODIFIER_KEYS: Record<string, number> = {
  ShiftLeft: 57441, ControlLeft: 57442, AltLeft: 57443, MetaLeft: 57444, ShiftRight: 57447, ControlRight: 57448, AltRight: 57449, MetaRight: 57450,
};

/** The key a physical position types on a US layout, unshifted: the spec's "base layout key" (and what a shifted
 *  symbol's own key number is read from). */
const US_BASE: Record<string, string> = {
  Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'",
  Comma: ",", Period: ".", Slash: "/", Space: " ", IntlBackslash: "\\",
};
export function usBase(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1].toLowerCase();
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];
  return US_BASE[code] ?? null;
}

const single = (s: string): boolean => [...s].length === 1;
const cp = (s: string): number => s.codePointAt(0) ?? 0;

/** The spec's modifier bits: shift 1, alt 2, ctrl 4, super 8, caps lock 64, num lock 128 (the field carries 1 + bits). */
export function modifierBits(e: KittyKey, withLocks: boolean): number {
  const altGr = !!e.altGraph;
  let m = 0;
  if (e.shiftKey) m |= 1;
  if (e.altKey && !altGr) m |= 2;
  if (e.ctrlKey && !altGr) m |= 4;
  if (e.metaKey) m |= 8;
  if (withLocks && e.capsLock) m |= 64;
  if (withLocks && e.numLock) m |= 128;
  return m;
}

/** TERM-082: CSI-u encoding of one key event under `flags`; null = not this protocol's to send (the pane keeps xterm's
 *  own handling: legacy text, dead keys, composition), "" = swallow (a release the program did not ask for). */
export function encodeKitty(e: KittyKey, flags: number): string | null {
  if (!flags) return null;
  if (e.isComposing || e.keyCode === 229 || e.key === "Dead" || e.key === "Process" || e.key === "Unidentified" || !e.key) return null;
  const all = (flags & KITTY.allAsEscapes) !== 0;
  const release = e.type === "keyup";
  const event = release ? 3 : e.repeat ? 2 : 1;
  if (event !== 1 && !(flags & KITTY.eventTypes)) return release ? "" : null;
  const mods = modifierBits(e, all);
  const textMods = mods & ~1 & ~64 & ~128; // Shift and the locks still type text
  const field = (force: boolean) => (mods || event !== 1 || force ? `;${mods + 1}${event !== 1 ? `:${event}` : ""}` : "");

  // A modifier key on its own: only when every key is an escape code.
  const modifierKey = MODIFIER_KEYS[e.code];
  if (modifierKey !== undefined || ["Shift", "Control", "Alt", "Meta", "AltGraph"].includes(e.key)) {
    if (!all || modifierKey === undefined) return release ? "" : null;
    return `\x1b[${modifierKey}${field(false)}u`;
  }

  if (all && KEYPAD[e.code] !== undefined) return `\x1b[${KEYPAD[e.code]}${field(false)}u`;

  const fn = FUNCTIONAL[e.key];
  if (fn) {
    const [n, final] = fn;
    const legacyEnter = e.key === "Enter" || e.key === "Tab" || e.key === "Backspace";
    if (legacyEnter && !all) {
      // Enter, Tab and Backspace keep their legacy bytes (and have no release) unless modified: the spec keeps them
      // so a shell can still type "reset" after a program died with the protocol on.
      if (release) return "";
      if (!mods) return null;
    }
    // Unmodified presses of keys whose legacy bytes are unambiguous stay xterm's (it also honours cursor-key mode).
    if (!mods && event === 1 && !all && e.key !== "Escape") return null;
    if (final === "u") return `\x1b[${n}${field(false)}u`;
    if (final === "~") return `\x1b[${n}${field(false)}~`;
    return mods || event !== 1 ? `\x1b[1${field(true)}${final}` : `\x1b[${final}`;
  }

  if (!single(e.key)) return release ? "" : null; // a named key the spec has no number for
  // A key that types text: its number is the unshifted key in the current layout (the spec's "key code").
  const lower = e.key.toLowerCase();
  const base = usBase(e.code);
  const own = e.shiftKey ? (lower !== e.key ? lower : (base ?? e.key)) : lower;
  // Plain text (no Ctrl/Alt/Super, AltGr counts as typing) is sent as text unless every key is an escape code.
  if (!all && !textMods && event === 1) return null;
  let key = String(cp(own));
  if (flags & KITTY.alternateKeys) {
    const shifted = e.shiftKey && e.key !== own ? String(cp(e.key)) : "";
    const layout = base && base !== own ? String(cp(base)) : "";
    if (shifted || layout) key += `:${shifted}${layout ? `:${layout}` : ""}`;
  }
  const typesText = !release && !textMods;
  const text = all && flags & KITTY.associatedText && typesText ? `;${[...e.key].map(cp).join(":")}` : "";
  return `\x1b[${key}${field(text !== "")}${text}u`;
}

/** TERM-086: Ctrl with a letter on a non-Latin layout (Russian, Greek) sends the control byte of the key's Latin
 *  letter, read from the physical key, as on a Latin layout; null = leave the key to xterm. */
export function latinControl(e: KittyKey): string | null {
  if (!e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.altGraph) return null;
  if (!single(e.key) || cp(e.key) < 0x80) return null; // a Latin layout already sends the right byte
  const letter = /^Key([A-Z])$/.exec(e.code);
  if (letter) return String.fromCharCode(letter[1].charCodeAt(0) - 64);
  const extra: Record<string, string> = { BracketLeft: "\x1b", Backslash: "\x1c", BracketRight: "\x1d" };
  return extra[e.code] ?? null;
}

/** One pane's protocol state: the two screens' flag stacks and the keys whose press went out encoded. */
export class KittyKeyboard {
  private main: Screen = blank();
  private alt: Screen = blank();
  private pressed = new Set<string>();

  private screen(alternate: boolean): Screen {
    return alternate ? this.alt : this.main;
  }

  /** The active flags on that screen (0 = the protocol is off). */
  flags(alternate: boolean): number {
    const s = this.screen(alternate);
    return s.stack.length ? s.stack[s.stack.length - 1] : s.base;
  }

  /** One CSI ... u from the program, by its prefix; returns the reply to send back ("" for none). */
  apply(prefix: string, params: number[], alternate: boolean): string {
    const s = this.screen(alternate);
    const p0 = Number.isFinite(params[0]) ? params[0] : 0;
    if (prefix === "?") return `\x1b[?${this.flags(alternate)}u`;
    if (prefix === ">") {
      s.stack.push(p0 & ALL_FLAGS);
      if (s.stack.length > KITTY_STACK_CAP) s.stack.shift();
    } else if (prefix === "<") {
      const n = Math.max(1, p0 || 1);
      s.stack.splice(Math.max(0, s.stack.length - n), n);
      if (!s.stack.length) s.base = 0; // a pop that empties the stack resets every flag
    } else if (prefix === "=") {
      const mode = Number.isFinite(params[1]) && params[1] ? params[1] : 1;
      const now = this.flags(alternate);
      const next = mode === 2 ? now | p0 : mode === 3 ? now & ~p0 : p0;
      if (s.stack.length) s.stack[s.stack.length - 1] = next & ALL_FLAGS;
      else s.base = next & ALL_FLAGS;
    }
    return "";
  }

  /** VIEW-109: the program ended (or the terminal was reset): the protocol is off on both screens. */
  reset(): void {
    this.main = blank();
    this.alt = blank();
    this.pressed.clear();
  }

  /** Encode a key event for the active screen. A release goes out only for a key whose press reached the program
   *  while event types were on. */
  encode(e: KittyKey, alternate: boolean): string | null {
    const flags = this.flags(alternate);
    if (e.type === "keyup") {
      if (!this.pressed.delete(e.code || e.key)) return null;
      return encodeKitty(e, flags);
    }
    const out = encodeKitty(e, flags);
    // Its release is reported later when the program asked for event types (a press sent as plain text included).
    if (flags & KITTY.eventTypes && out !== "") this.pressed.add(e.code || e.key);
    return out;
  }
}

/** TERM-085: the keybinding command that switches the OS input source; it ships unbound in the keybinding table, so no
 *  ordinary chord ever switches it. */
export const INPUT_SOURCE_ACTION = "terminal.switchInputSource";
