import { describe, expect, it } from "vitest";
import { openerRefocus, pageChord } from "./chord";

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
