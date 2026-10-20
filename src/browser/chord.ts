import { getCurrentWindow } from "@tauri-apps/api/window";

// Council FIX-3 (FIX-SOON 1). A key pressed inside a browser page reaches the app as a chord while
// the page's own webview holds the keyboard, so the app's window does not have focus
// (`document.hasFocus()` is false). A chord that arrives while the app's window has focus was sent
// by the page's script, not pressed: it must not move the keyboard or the focused pane.
// Council FIX-4: `document.hasFocus()` is also false while the user is in another program, so the
// app's window must hold the keyboard at the system level as well (`windowFocused`), and a page in
// another split, which neither check can tell from a real press (T-272-d), takes the keyboard at
// most once a second per tab.
// Council FIX-5: only a chord that takes the keyboard (the address-bar chord) uses that allowance,
// so a real back, reload or find right before a real Ctrl+L no longer eats it; the allowance is
// timed with the monotonic clock, so a system clock set back cannot freeze a tab's chords.

/// Chords that only act on the page itself; a page could do these to itself anyway.
const PAGE_ONLY = new Set(["zoomIn", "zoomOut", "zoomReset", "back", "forward", "reload"]);

export type ChordPlan = { focusPane: boolean; run: boolean; takeKeyboard: boolean };

/// What the app does with a chord `what` from a page; `appHasFocus` is `document.hasFocus()`,
/// `windowFocused` is whether the app's window holds the keyboard at the system level (a child
/// page holding it still counts).
export function pageChord(what: string, appHasFocus: boolean, windowFocused = true): ChordPlan {
  if (!appHasFocus && windowFocused) return { focusPane: true, run: true, takeKeyboard: what === "focusAddressBar" };
  return { focusPane: false, run: PAGE_ONLY.has(what), takeKeyboard: false };
}

/// Whether a tab opened behind gives the keyboard back to the pane that opened it: only when the
/// click was really in the page (the app's window holds the keyboard, its own view does not).
export function openerRefocus(front: boolean, appHasFocus: boolean, windowFocused = true): boolean {
  return !front && !appHasFocus && windowFocused;
}

/// The shortest time between two keyboard-taking chords from one tab.
export const CHORD_GAP_MS = 1000;

/// Whether tab `id` may move focus at `now` (ms); an allowed one is recorded in `last`.
export function focusAllowed(last: Map<number, number>, id: number, now: number): boolean {
  const at = last.get(id);
  if (at !== undefined && now - at < CHORD_GAP_MS) return false;
  last.set(id, now);
  return true;
}

/// A plan that would take the keyboard is let through once a second per tab; past that it is
/// treated as a chord the page's script sent. A plan that only focuses the pane (back, reload,
/// find, zoom) is not limited and does not use the allowance: it never moves the keyboard.
export function limitChord(what: string, plan: ChordPlan, last: Map<number, number>, id: number, now: number): ChordPlan {
  if (!plan.takeKeyboard) return plan;
  return focusAllowed(last, id, now) ? plan : pageChord(what, true);
}

const lastFocus = new Map<number, number>();

let focusReadFailed = false;

/// Whether the app's window holds the keyboard at the system level; false when it cannot be read
/// (fails closed), and the first such failure is logged so dropped chords leave a trace.
export function windowHasFocus(): Promise<boolean> {
  return getCurrentWindow()
    .isFocused()
    .catch((e: unknown) => {
      if (!focusReadFailed) {
        focusReadFailed = true;
        console.warn("browser: reading the app window's focus failed; page chords and opener refocus are refused until it works:", e);
      }
      return false;
    });
}

/// The plan for a chord that just arrived from tab `id`, with every check above applied.
export async function chordPlan(id: number, what: string): Promise<ChordPlan> {
  const appHasFocus = document.hasFocus();
  return limitChord(what, pageChord(what, appHasFocus, await windowHasFocus()), lastFocus, id, performance.now());
}
