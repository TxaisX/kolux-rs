// SET-009: the double-tap modifier matcher.
import { expect, test } from "vitest";
import { actionForTap, createDoubleTap, doubleTapLabel, doubleTapSpelling, parseDoubleTap, recordDoubleTap } from "./doubleTap";
import { parseChord } from "./keymap";

const ev = (code: string, o: Partial<{ repeat: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) => ({
  code, key: code, ctrlKey: false, altKey: false, shiftKey: code.startsWith("Shift"), metaKey: false, ...o,
});

test("SET-009: Shift then Shift within 300 ms counts, and the matcher starts over after", () => {
  const m = createDoubleTap();
  expect(m.down(ev("ShiftLeft"), 1000)).toBeNull();
  expect(m.down(ev("ShiftLeft"), 1250)).toBe("Shift");
  expect(m.down(ev("ShiftLeft"), 1300)).toBeNull(); // a third tap is a new first tap
});

test("SET-009: a second tap later than 300 ms, or on the other Shift key, does not count", () => {
  const m = createDoubleTap();
  m.down(ev("ShiftLeft"), 0);
  expect(m.down(ev("ShiftLeft"), 301)).toBeNull();
  expect(m.down(ev("ShiftLeft"), 400)).toBe("Shift"); // the late tap became the first of a new pair
  m.reset();
  m.down(ev("ShiftLeft"), 0);
  expect(m.down(ev("ShiftRight"), 100)).toBeNull();
});

test("SET-009: another key between the taps, another modifier held, or a key repeat cancels or is ignored", () => {
  const m = createDoubleTap();
  m.down(ev("ControlLeft", { ctrlKey: true }), 0);
  m.down(ev("KeyA", { ctrlKey: true }), 50);
  expect(m.down(ev("ControlLeft", { ctrlKey: true }), 100)).toBeNull();
  m.reset();
  m.down(ev("ShiftLeft"), 0);
  expect(m.down(ev("ShiftLeft", { repeat: true }), 40)).toBeNull();
  expect(m.down(ev("ShiftLeft"), 120)).toBe("Shift"); // the repeat neither counted nor cancelled
  m.reset();
  m.down(ev("ShiftLeft", { altKey: true }), 0);
  expect(m.down(ev("ShiftLeft", { altKey: true }), 80)).toBeNull();
});

test("SET-009: Ctrl, Alt and Cmd can be doubled too", () => {
  const m = createDoubleTap();
  m.down(ev("MetaLeft", { metaKey: true }), 0);
  expect(m.down(ev("MetaLeft", { metaKey: true }), 90)).toBe("Cmd");
  m.down(ev("AltRight", { altKey: true }), 0);
  expect(m.down(ev("AltRight", { altKey: true }), 90)).toBe("Alt");
});

test("SET-009: the spelling round-trips, reads on screen, is not a normal chord, and runs the bound command", () => {
  expect(doubleTapSpelling("Shift")).toBe("Double+Shift");
  expect(parseDoubleTap("double+shift")).toBe("Shift");
  expect(parseDoubleTap("Mod+Shift")).toBeNull();
  expect(doubleTapLabel("Shift", "win32")).toBe("Shift Shift");
  expect("error" in parseChord("Double+Shift")).toBe(true);
  const bound = [{ id: "a", chords: ["Mod+K"] }, { id: "palette", chords: ["Double+Shift"] }];
  expect(actionForTap(bound, "Shift")).toBe("palette");
  expect(actionForTap(bound, "Ctrl")).toBeNull();
});

test("SET-009: recording a double tap answers its spelling only when the second tap lands", () => {
  const m = createDoubleTap();
  expect(recordDoubleTap(m, ev("ShiftLeft"), 0)).toBeNull();
  expect(recordDoubleTap(m, ev("ShiftLeft"), 200)).toBe("Double+Shift");
});
