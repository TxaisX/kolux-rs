import { describe, expect, it } from "vitest";
import { CHORD_GAP_MS, focusAllowed, limitChord, openerRefocus, pageChord } from "./chord";

// Council FIX-3 (FIX-SOON 1): a chord the page sends while the app's own window holds the
// keyboard was not pressed in the page, so it never moves the keyboard or the focused pane.
describe("BROW-003 / BROW-005 chords sent by a page", () => {
  it("a real chord (the keyboard is inside the page) focuses the pane and runs", () => {
    expect(pageChord("focusAddressBar", false)).toEqual({ focusPane: true, run: true, takeKeyboard: true });
    expect(pageChord("find", false)).toEqual({ focusPane: true, run: true, takeKeyboard: false });
    expect(pageChord("zoomIn", false)).toEqual({ focusPane: true, run: true, takeKeyboard: false });
  });

  it("while the app holds the keyboard, focusAddressBar and find do nothing and nothing takes focus", () => {
    for (const what of ["focusAddressBar", "find"]) expect(pageChord(what, true)).toEqual({ focusPane: false, run: false, takeKeyboard: false });
  });

  it("page-only actions (zoom, back, forward, reload) still run, without focusing the pane", () => {
    for (const what of ["zoomIn", "zoomOut", "zoomReset", "back", "forward", "reload"]) {
      expect(pageChord(what, true)).toEqual({ focusPane: false, run: true, takeKeyboard: false });
    }
  });

  it("a tab opened behind gives the keyboard back to its opener only for a real click in the page", () => {
    expect(openerRefocus(false, false)).toBe(true);
    expect(openerRefocus(false, true)).toBe(false);
    expect(openerRefocus(true, false)).toBe(false);
  });
});

// Council FIX-4 (review item 3): the user is in another program, so the app's window is not
// focused and the page's `document.hasFocus()` reads false as well.
describe("BROW-003 / BROW-005 chords while the user is in another program", () => {
  it("no chord moves the keyboard or the focused pane; page-only actions still run", () => {
    for (const what of ["focusAddressBar", "find"]) expect(pageChord(what, false, false)).toEqual({ focusPane: false, run: false, takeKeyboard: false });
    for (const what of ["zoomIn", "back", "reload"]) expect(pageChord(what, false, false)).toEqual({ focusPane: false, run: true, takeKeyboard: false });
  });

  it("a tab opened behind does not pull the keyboard back to its opener", () => {
    expect(openerRefocus(false, false, false)).toBe(false);
    expect(openerRefocus(false, false, true)).toBe(true);
  });
});

// Council FIX-4 (review item 3b): a page in another split cannot be told apart from a real key
// press without the engine's own key events (T-272-d), so each tab moves focus at most once a second.
describe("BROW-003 focus-moving chords are rate-limited per tab", () => {
  it("one per tab per second, other tabs unaffected, and the limit lifts at exactly one second", () => {
    const last = new Map<number, number>();
    expect(focusAllowed(last, 1, 10_000)).toBe(true);
    expect(focusAllowed(last, 1, 10_300)).toBe(false);
    expect(focusAllowed(last, 1, 10_000 + CHORD_GAP_MS - 1)).toBe(false);
    expect(focusAllowed(last, 2, 10_300)).toBe(true);
    expect(focusAllowed(last, 1, 10_000 + CHORD_GAP_MS)).toBe(true);
    // A refused chord does not push the window out: the next one is due a second after the last allowed.
    expect(focusAllowed(last, 1, 11_500)).toBe(false);
    expect(focusAllowed(last, 1, 12_000)).toBe(true);
  });

  it("a page looping focusAddressBar every 300 ms takes the keyboard at most once a second", () => {
    const last = new Map<number, number>();
    let took = 0;
    for (let t = 0; t < 3000; t += 300) {
      const plan = limitChord("focusAddressBar", pageChord("focusAddressBar", false, true), last, 7, t);
      if (plan.takeKeyboard) took++;
      else expect(plan).toEqual({ focusPane: false, run: false, takeKeyboard: false });
    }
    expect(took).toBe(3);
  });

  it("page-only chords are never limited and never use up the allowance", () => {
    const last = new Map<number, number>();
    for (let t = 0; t < 1000; t += 100) expect(limitChord("zoomIn", pageChord("zoomIn", true), last, 3, t)).toEqual({ focusPane: false, run: true, takeKeyboard: false });
    expect(last.has(3)).toBe(false);
  });

  // Council FIX-5 (review AFTER 1): only a chord that takes the keyboard uses the allowance, so a
  // real Alt+Left, Ctrl+R or Ctrl+F right before a real Ctrl+L no longer eats the Ctrl+L.
  it("chords that do not take the keyboard pass unlimited and leave the allowance unused", () => {
    const last = new Map<number, number>();
    for (const [what, t] of [["back", 0], ["reload", 10], ["find", 20], ["back", 30]] as const) {
      expect(limitChord(what, pageChord(what, false, true), last, 3, t)).toEqual({ focusPane: true, run: true, takeKeyboard: false });
    }
    expect(last.has(3)).toBe(false);
    expect(limitChord("focusAddressBar", pageChord("focusAddressBar", false, true), last, 3, 40)).toEqual({ focusPane: true, run: true, takeKeyboard: true });
    expect(last.get(3)).toBe(40);
    // After a Ctrl+L, the next back still acts; a second Ctrl+L inside the second is refused.
    expect(limitChord("back", pageChord("back", false, true), last, 3, 50)).toEqual({ focusPane: true, run: true, takeKeyboard: false });
    expect(limitChord("focusAddressBar", pageChord("focusAddressBar", false, true), last, 3, 60)).toEqual({ focusPane: false, run: false, takeKeyboard: false });
  });
});
