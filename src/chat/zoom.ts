// Native chat, text zoom (CHAT-026; T-334): Ctrl or Cmd with plus, minus or zero while the chat has
// focus makes the chat text a tenth bigger or smaller, from 0.8x to 1.6x; zero is back to normal.
// The three chords are fixed inside chat (not rebindable), and the zoom lasts only for the session.

export const ZOOM_MIN = 0.8;
export const ZOOM_MAX = 1.6;
export const ZOOM_STEP = 0.1;

export type Chord = { key: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; isComposing?: boolean };

/** The zoom the chord asks for, or null when it is not one of the three. Plus works with or without Shift (the = key). */
export function zoomChord(e: Chord): "in" | "out" | "reset" | null {
  if (e.isComposing || e.altKey || !(e.ctrlKey || e.metaKey)) return null;
  if (e.key === "+" || e.key === "=" || e.code === "NumpadAdd" || e.code === "Equal") return "in";
  if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract" || e.code === "Minus") return "out";
  if (e.key === "0" || e.code === "Numpad0" || e.code === "Digit0") return "reset";
  return null;
}

/** One step from `now`, kept inside the range and on whole tenths (no 1.2000000000000002). */
export function stepZoom(now: number, how: "in" | "out" | "reset"): number {
  if (how === "reset") return 1;
  const next = Math.round((now + (how === "in" ? ZOOM_STEP : -ZOOM_STEP)) * 10) / 10;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
}

// Session only: nothing is saved, a restart is back to 1x.
let current = 1;
export const chatZoom = () => current;
export function setChatZoom(z: number) {
  current = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}
/** The zoom as the label reads it: 1x, 1.2x. */
export const zoomLabel = (z: number) => `${Math.round(z * 10) / 10}x`;
