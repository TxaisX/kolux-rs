// SET-009 (T-246-b): a shortcut that is one modifier tapped twice (Shift then Shift). It counts only when
// the second press of that same key comes within about 300 ms, with no other key between, no other
// modifier held, and no key repeat. Spelled "Double+Shift" in the keybindings file (parseChord refuses
// it, so an old build reads it as a bad chord, never as a different shortcut). Pure; the window's key
// handler feeds `down` every keydown with a clock reading.
import type { Platform } from "./actions";

export const DOUBLE_TAP_MS = 300;
export type TapKey = "Shift" | "Ctrl" | "Alt" | "Cmd";

type Down = { code: string; key: string; repeat?: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean };

const BY_CODE: Record<string, TapKey> = { ShiftLeft: "Shift", ShiftRight: "Shift", ControlLeft: "Ctrl", ControlRight: "Ctrl", AltLeft: "Alt", AltRight: "Alt", MetaLeft: "Cmd", MetaRight: "Cmd", OSLeft: "Cmd", OSRight: "Cmd" };
const HELD: Record<TapKey, "ctrlKey" | "altKey" | "shiftKey" | "metaKey"> = { Shift: "shiftKey", Ctrl: "ctrlKey", Alt: "altKey", Cmd: "metaKey" };
const TAPS: TapKey[] = ["Shift", "Ctrl", "Alt", "Cmd"];

/** The file's spelling of a double tap. */
export const doubleTapSpelling = (k: TapKey) => `Double+${k}`;
/** Which modifier a spelling doubles, or null when it is not a double tap. */
export const parseDoubleTap = (text: string): TapKey | null => {
  const m = /^Double\+(\w+)$/i.exec(text.trim());
  return (m && TAPS.find((k) => k.toLowerCase() === m[1].toLowerCase())) || null;
};
/** How it reads on screen: "Shift Shift". */
export const doubleTapLabel = (k: TapKey, _platform: Platform) => `${k} ${k}`;

/** One matcher per window; `down` answers the modifier whose second tap just completed, else null. */
export function createDoubleTap(ms = DOUBLE_TAP_MS) {
  let last: { code: string; at: number } | null = null;
  return {
    down(e: Down, now: number): TapKey | null {
      const tap = BY_CODE[e.code];
      if (!tap) {
        last = null; // another key between the taps
        return null;
      }
      if (e.repeat) return null; // a held modifier repeating is not a tap
      if (TAPS.some((k) => k !== tap && e[HELD[k]])) {
        last = null; // another modifier is held
        return null;
      }
      if (last && last.code === e.code && now - last.at <= ms) {
        last = null;
        return tap;
      }
      last = { code: e.code, at: now };
      return null;
    },
    reset() {
      last = null;
    },
  };
}

/** The command a completed double tap runs: the first binding that lists its spelling. */
export function actionForTap(bindings: ReadonlyArray<{ id: string; chords: readonly string[] }>, tap: TapKey): string | null {
  const want = doubleTapSpelling(tap);
  return bindings.find((b) => b.chords.includes(want))?.id ?? null;
}

/** The recorder (SET-009): a double tap recorded in place of a chord; null while it is not complete. */
export function recordDoubleTap(matcher: ReturnType<typeof createDoubleTap>, e: Down, now: number): string | null {
  const tap = matcher.down(e, now);
  return tap ? doubleTapSpelling(tap) : null;
}
