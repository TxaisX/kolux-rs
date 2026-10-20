// SET-009 (T-246-d): a double tap in the keybindings file reaches a command through the keymap.
import { expect, test } from "vitest";
import { createDoubleTap } from "./doubleTap";
import { chordsOf, labelOf, labelParts, matchEvent, resolve } from "./keymap";
import { tapHit } from "./tapHit";

const shift = (o: { repeat?: boolean } = {}) => ({ code: "ShiftLeft", key: "Shift", ctrlKey: false, altKey: false, shiftKey: true, metaKey: false, ...o });
const file = { keybindings: { "app.settings": "Double+Shift" } };

test("SET-009: the keymap keeps Double+Shift as written, with no error, and draws it as one cap", () => {
  const map = resolve(file, "win32");
  expect(map.errors).toEqual([]);
  expect(chordsOf(map, "app.settings")).toEqual(["Double+Shift"]);
  expect(labelParts("Double+Shift", "win32")).toEqual(["Shift Shift"]);
  expect(labelOf(map, "app.settings")).toEqual(["Shift Shift"]);
  expect(labelParts("double+ctrl", "darwin")).toEqual(["Ctrl Ctrl"]);
});

test("SET-009: a spelling that is not a modifier is a bad chord and the default stays", () => {
  const map = resolve({ keybindings: { "app.settings": "Double+J" } }, "win32");
  expect(map.errors.join()).toContain("Double+J");
  expect(chordsOf(map, "app.settings")).toEqual(resolve(null, "win32").bindings.get("app.settings")!.chords);
});

test("SET-009: two commands on the same double tap clash and the custom ones are dropped", () => {
  const map = resolve({ keybindings: { "app.settings": "Double+Shift", "app.forceReload": "Double+Shift" } }, "win32");
  expect(map.clashes.some((c) => c.chord === "Double+Shift")).toBe(true);
});

test("SET-009: the second Shift within 300 ms runs the command bound to it; one tap or a plain chord match does not", () => {
  const map = resolve(file, "win32");
  const m = createDoubleTap();
  expect(tapHit(m, map, shift(), 1000)).toBeNull();
  expect(tapHit(m, map, shift(), 1200)).toEqual({ id: "app.settings" });
  expect(tapHit(m, map, shift(), 5000)).toBeNull();
  // The ordinary matcher never fires for a lone modifier, so the two paths cannot both answer.
  expect(matchEvent(map, { ...shift(), code: "ShiftLeft" }, ["global"])).toBeNull();
});

test("SET-009: a double tap nobody bound answers nothing", () => {
  const map = resolve(null, "win32");
  const m = createDoubleTap();
  tapHit(m, map, shift(), 0);
  expect(tapHit(m, map, shift(), 100)).toBeNull();
});
