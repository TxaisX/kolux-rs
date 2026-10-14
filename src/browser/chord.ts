// Council FIX-3 (FIX-SOON 1). A key pressed inside a browser page reaches the app as a chord while
// the page's own webview holds the keyboard, so the app's window does not have focus
// (`document.hasFocus()` is false). A chord that arrives while the app's window has focus was sent
// by the page's script, not pressed: it must not move the keyboard or the focused pane.

/// Chords that only act on the page itself; a page could do these to itself anyway.
const PAGE_ONLY = new Set(["zoomIn", "zoomOut", "zoomReset", "back", "forward", "reload"]);

export type ChordPlan = { focusPane: boolean; run: boolean; takeKeyboard: boolean };

/// What the app does with a chord `what` from a page; `appHasFocus` is `document.hasFocus()`.
export function pageChord(what: string, appHasFocus: boolean): ChordPlan {
  if (!appHasFocus) return { focusPane: true, run: true, takeKeyboard: what === "focusAddressBar" };
  return { focusPane: false, run: PAGE_ONLY.has(what), takeKeyboard: false };
}

/// Whether a tab opened behind gives the keyboard back to the pane that opened it: only when the
/// click was really in the page (the app's window does not hold the keyboard).
export function openerRefocus(front: boolean, appHasFocus: boolean): boolean {
  return !front && !appHasFocus;
}
