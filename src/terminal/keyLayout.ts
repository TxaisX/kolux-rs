// VIEW-109 (T-253): shortcut labels follow the keyboard layout in use. A letter or digit chord fires on the key that
// types it as well as on its US position (keymap.ts keyMatches), so its label is right on every layout; a punctuation
// chord fires only on its physical position, so on a German layout the chord written Ctrl+/ fires on the key printed
// "-", and its label should say "-". The layout comes from the web platform's Keyboard Map API (navigator.keyboard
// getLayoutMap, a code -> character map, available in the Windows web view) and is read again when the layout changes
// (the "layoutchange" event) and when the window gets the focus back (a switch made in another program).
// Pure apart from the small watcher at the end, which never throws when the API is missing.

/** The part of the Keyboard Map API this file reads. */
export type LayoutMap = { get(code: string): string | undefined };

/** Named chord keys that are also physical key codes, and the character they type on a US layout. */
const NAMED_CODES: Record<string, string> = {
  Comma: ",", Period: ".", Equal: "=", Minus: "-", Slash: "/", Backslash: "\\", Backquote: "`", Quote: "'", Semicolon: ";", BracketLeft: "[", BracketRight: "]",
};

/** The physical key code a punctuation chord key sits on, or null for a key whose label never depends on the layout
 *  (letters and digits also match the key that types them; Enter, F1 and the arrows are the same everywhere). */
export function chordKeyCode(key: string): string | null {
  return key in NAMED_CODES ? key : null;
}

/** The label of a chord key under `layout`; `fallback` (the US label) when the layout is unknown or types nothing there. */
export function layoutKeyLabel(key: string, layout: LayoutMap | null, fallback: string): string {
  const code = chordKeyCode(key);
  if (!code || !layout) return fallback;
  const ch = layout.get(code);
  if (!ch || [...ch].length !== 1 || /\s/.test(ch)) return fallback;
  const upper = ch.toUpperCase();
  return [...upper].length === 1 ? upper : ch; // ß stays ß, not SS
}

let current: LayoutMap | null = null;
/** The layout read last, or null before the first read (or where the API is missing). */
export const currentLayout = (): LayoutMap | null => current;
/** Fired on window when the layout map changes, so open labels can redraw. */
export const LAYOUT_EVENT = "kolux-keyboard-layout";

type KeyboardApi = { getLayoutMap(): Promise<LayoutMap>; addEventListener?(type: string, fn: () => void): void; removeEventListener?(type: string, fn: () => void): void };

/** Read the layout now and again on every change; returns the cleanup. Missing API or a refusal leaves the US labels. */
export function watchLayout(keyboard: KeyboardApi | undefined, win: Pick<Window, "addEventListener" | "removeEventListener" | "dispatchEvent"> | undefined): () => void {
  if (!keyboard?.getLayoutMap) return () => {};
  const read = () => {
    keyboard.getLayoutMap().then(
      (m) => {
        current = m;
        win?.dispatchEvent(new Event(LAYOUT_EVENT));
      },
      () => {},
    );
  };
  read();
  keyboard.addEventListener?.("layoutchange", read);
  win?.addEventListener("focus", read);
  return () => {
    keyboard.removeEventListener?.("layoutchange", read);
    win?.removeEventListener("focus", read);
  };
}

/** For tests: forget the layout read. */
export const resetLayout = () => {
  current = null;
};

// Started once for the window; labels read currentLayout() when they draw.
if (typeof window !== "undefined" && typeof navigator !== "undefined") {
  try {
    watchLayout((navigator as Navigator & { keyboard?: KeyboardApi }).keyboard, window);
  } catch {
    // no layout API: the US labels stay
  }
}
