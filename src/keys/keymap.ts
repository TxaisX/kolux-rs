// Chords and the keymap (COMPAT.md 4.1 and 4.2, SET-011, SET-013). A chord is modifier names
// and one key joined by "+", such as "Mod+Shift+ArrowUp". The keymap is the built-in defaults
// for this platform, then the file's all-platforms section, then its section for this platform.
// A custom chord that collides with another binding in the same scope (or conflict group) is
// dropped and the default stays, so an edit can never silently steal a key.
import { actionById, actions, defaultsFor, type Action, type Platform, type Scope } from "./actions";

export const MODIFIERS = ["Mod", "Ctrl", "Cmd", "Meta", "Alt", "Shift"] as const;
type Modifier = (typeof MODIFIERS)[number];

export type Chord = { mod: boolean; ctrl: boolean; meta: boolean; alt: boolean; shift: boolean; key: string };

/** Parses "Mod+Shift+J" into its parts; a bad chord returns an error message instead. */
export function parseChord(text: string): Chord | { error: string } {
  const parts = text.split("+").map((p) => p.trim());
  // "Mod+Shift+Plus" ends in a key that is itself "+", which split() turns into two empty parts.
  if (parts.length >= 2 && parts[parts.length - 1] === "" && parts[parts.length - 2] === "") parts.splice(-2, 2, "Plus");
  if (parts.length === 0 || parts.some((p) => p === "")) return { error: `"${text}" is not a chord` };
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const chord: Chord = { mod: false, ctrl: false, meta: false, alt: false, shift: false, key: canonicalKey(key) };
  for (const m of mods) {
    const name = MODIFIERS.find((x) => x.toLowerCase() === m.toLowerCase());
    if (!name) return { error: `"${text}": "${m}" is not a modifier` };
    const flag = ({ Mod: "mod", Ctrl: "ctrl", Cmd: "meta", Meta: "meta", Alt: "alt", Shift: "shift" } as Record<Modifier, keyof Chord>)[name];
    if (chord[flag]) return { error: `"${text}" repeats ${name}` };
    (chord as unknown as Record<string, boolean>)[flag] = true;
  }
  if (chord.mod && (chord.ctrl || chord.meta)) return { error: `"${text}" mixes Mod with Ctrl or Cmd` };
  if ((MODIFIERS as readonly string[]).some((m) => m.toLowerCase() === key.toLowerCase())) return { error: `"${text}" has no key` };
  return chord;
}

/** Letters upper-case, named keys in their W3C spelling, so "ctrl+shift+j" equals "Ctrl+Shift+J". */
function canonicalKey(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  const named = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Backspace", "Enter", "Tab", "Escape", "Delete", "Insert", "Home", "End", "PageUp", "PageDown", "Space", "Comma", "Period", "Equal", "Minus", "Plus", "Slash", "Backslash", "Backquote", "Quote", "Semicolon", "BracketLeft", "BracketRight", "NumpadAdd", "NumpadSubtract"];
  return named.find((n) => n.toLowerCase() === key.toLowerCase()) ?? key;
}

export function chordToString(c: Chord): string {
  const parts: string[] = [];
  if (c.mod) parts.push("Mod");
  if (c.ctrl) parts.push("Ctrl");
  if (c.meta) parts.push("Cmd");
  if (c.alt) parts.push("Alt");
  if (c.shift) parts.push("Shift");
  parts.push(c.key);
  return parts.join("+");
}

/** The digit-index actions take a chord ending in 1 and cover 1 to 9; another digit is rewritten to 1. */
export function normaliseIndexChord(chord: string): string {
  return chord.replace(/\+[1-9]$/, "+1");
}

/** How a chord reads on screen, as parts: "Mod+Shift+J" is ["Ctrl", "Shift", "J"] on Windows. */
export function labelParts(chord: string, platform: Platform): string[] {
  const c = parseChord(chord);
  if ("error" in c) return [chord];
  const parts: string[] = [];
  const mac = platform === "darwin";
  if (c.ctrl || (c.mod && !mac)) parts.push("Ctrl");
  if (c.alt) parts.push(mac ? "Option" : "Alt");
  if (c.shift) parts.push("Shift");
  if (c.meta || (c.mod && mac)) parts.push("Cmd");
  parts.push(keyLabel(c.key));
  return parts;
}

const keyLabels: Record<string, string> = { Comma: ",", Period: ".", Equal: "=", Minus: "-", Plus: "+", Slash: "/", Backslash: "\\", Backquote: "`", Quote: "'", Semicolon: ";", BracketLeft: "[", BracketRight: "]", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", NumpadAdd: "Numpad +", NumpadSubtract: "Numpad -", Escape: "Esc", PageUp: "PgUp", PageDown: "PgDn", Backspace: "Backspace", Delete: "Del", Insert: "Ins" };
export const keyLabel = (key: string): string => keyLabels[key] ?? key;

export type Binding = { action: Action; chords: string[]; custom: boolean };
export type Keymap = {
  platform: Platform;
  bindings: Map<string, Binding>;
  errors: string[];
  warnings: string[];
};

const PLATFORMS: Platform[] = ["win32", "linux", "darwin"];
const RESERVED = new Set(["$schema", "version", "keybindings", "platforms"]);

/** Builds the keymap from the file's JSON (null means "no file, defaults only"). */
export function resolve(file: unknown, platform: Platform): Keymap {
  const errors: string[] = [];
  const warnings: string[] = [];
  const bindings = new Map<string, Binding>(actions.map((x) => [x.id, { action: x, chords: defaultsFor(x, platform), custom: false }]));
  if (file !== null && file !== undefined) {
    if (!isObject(file)) {
      errors.push("The shortcuts file is not a JSON object; the default shortcuts are in use.");
    } else {
      // The all-platforms section: `keybindings` when present, else the older form with ids at the top level.
      let shared: Record<string, unknown>;
      if ("keybindings" in file) {
        if (isObject(file.keybindings)) shared = file.keybindings;
        else {
          shared = {};
          errors.push('"keybindings" must be an object of command ids; it was ignored.');
        }
      } else {
        shared = Object.fromEntries(Object.entries(file).filter(([k]) => !RESERVED.has(k)));
      }
      applySection(shared, bindings, errors, warnings, "all platforms");
      if ("platforms" in file) {
        if (!isObject(file.platforms)) errors.push('"platforms" must be an object with darwin, linux and win32 sections; it was ignored.');
        else {
          for (const name of Object.keys(file.platforms)) {
            if (!PLATFORMS.includes(name as Platform)) warnings.push(`"${name}" is not a platform (darwin, linux or win32); its section was ignored.`);
          }
          const own = file.platforms[platform];
          if (own !== undefined) {
            if (isObject(own)) applySection(own, bindings, errors, warnings, platform);
            else errors.push(`The ${platform} section must be an object of command ids; it was ignored.`);
          }
        }
      }
    }
  }
  dropConflicts(bindings, errors, platform);
  return { platform, bindings, errors, warnings };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function applySection(section: Record<string, unknown>, bindings: Map<string, Binding>, errors: string[], warnings: string[], where: string) {
  for (const [id, raw] of Object.entries(section)) {
    const binding = bindings.get(id);
    if (!binding) {
      warnings.push(`"${id}" (${where}) is not a command Kolux knows; it was ignored.`);
      continue;
    }
    let chords: string[];
    if (raw === null || raw === false) chords = [];
    else if (typeof raw === "string") chords = [raw];
    else if (Array.isArray(raw) && raw.every((x) => typeof x === "string")) chords = raw as string[];
    else {
      errors.push(`"${id}" (${where}) must be a chord, a list of chords, null or false; its default stays.`);
      continue;
    }
    const parsed: string[] = [];
    let bad: string | null = null;
    for (const text of chords) {
      const c = parseChord(text);
      if ("error" in c) {
        bad = c.error;
        break;
      }
      parsed.push(binding.action.index ? normaliseIndexChord(chordToString(c)) : chordToString(c));
    }
    if (bad) {
      errors.push(`"${id}" (${where}): ${bad}; its default stays.`);
      continue;
    }
    bindings.set(id, { action: binding.action, chords: parsed, custom: true });
  }
}

/** The same bucket is the same scope, or the same conflict group. */
function buckets(action: Action): string[] {
  return action.group ? [`scope:${action.scope}`, `group:${action.group}`] : [`scope:${action.scope}`];
}

function dropConflicts(bindings: Map<string, Binding>, errors: string[], platform: Platform) {
  for (let round = 0; round < 8; round++) {
    const seen = new Map<string, Binding[]>();
    for (const b of bindings.values()) {
      for (const chord of b.chords) for (const bucket of buckets(b.action)) {
        const key = `${bucket}|${chord}`;
        seen.set(key, [...(seen.get(key) ?? []), b]);
      }
    }
    const dropped = new Set<Binding>();
    for (const group of seen.values()) {
      if (group.length < 2 || !group.some((b) => b.custom)) continue;
      for (const b of group) if (b.custom) dropped.add(b);
    }
    if (dropped.size === 0) return;
    const names = [...dropped].map((b) => b.action.title).sort();
    errors.push(`These custom shortcuts clash with another in the same place and were dropped, their defaults stay: ${names.join(", ")}.`);
    for (const b of dropped) bindings.set(b.action.id, { action: b.action, chords: defaultsFor(b.action, platform), custom: false });
  }
}

export type KeyLike = { key: string; code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean };
export type Match = { id: string; index?: number };

/** Does this chord fire for this key event? Returns the digit for index actions. */
export function chordMatches(chord: string, e: KeyLike, platform: Platform, index = false): { index?: number } | null {
  const c = parseChord(chord);
  if ("error" in c) return null;
  const mac = platform === "darwin";
  const wantCtrl = c.ctrl || (c.mod && !mac);
  const wantMeta = c.meta || (c.mod && mac);
  if (e.ctrlKey !== wantCtrl || e.metaKey !== wantMeta || e.altKey !== c.alt || e.shiftKey !== c.shift) return null;
  if (index && c.key === "1") {
    const d = /^Digit([1-9])$/.exec(e.code)?.[1] ?? (/^[1-9]$/.test(e.key) ? e.key : null);
    return d ? { index: Number(d) } : null;
  }
  return keyMatches(c.key, e) ? {} : null;
}

function keyMatches(key: string, e: KeyLike): boolean {
  if (/^[A-Z]$/.test(key)) return e.code === `Key${key}` || e.key.toUpperCase() === key;
  if (/^[0-9]$/.test(key)) return e.code === `Digit${key}` || e.key === key;
  if (key === "Plus") return e.key === "+" || e.code === "NumpadAdd";
  if (key === "Space") return e.code === "Space" || e.key === " ";
  return e.code === key || e.key === key;
}

/** The first action in the wanted scopes whose chord fires for this event. */
export function matchEvent(map: Keymap, e: KeyLike, scopes: Scope[]): Match | null {
  for (const b of map.bindings.values()) {
    if (!scopes.includes(b.action.scope)) continue;
    for (const chord of b.chords) {
      const hit = chordMatches(chord, e, map.platform, b.action.index);
      if (hit) return hit.index === undefined ? { id: b.action.id } : { id: b.action.id, index: hit.index };
    }
  }
  return null;
}

/** The chords of one action, or [] when it is unassigned. */
export function chordsOf(map: Keymap, id: string): string[] {
  return map.bindings.get(id)?.chords ?? [];
}

/** Label parts for the first chord of an action; [] when it has none. */
export function labelOf(map: Keymap, id: string): string[] {
  const chord = chordsOf(map, id)[0];
  return chord ? labelParts(chord, map.platform) : [];
}

export const defaultsOnly = (platform: Platform): Keymap => resolve(null, platform);

export function detectPlatform(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent): Platform {
  if (/Mac OS X|Macintosh/.test(ua)) return "darwin";
  if (/Linux/.test(ua) && !/Android/.test(ua)) return "linux";
  return "win32";
}

export { actionById };
