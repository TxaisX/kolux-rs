import { expect, test } from "vitest";
import { batchQuestion, clickRow, isToggleClick, selectionAfterDelete } from "./selection";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const clean = { changes: [], locked: null, nested: [], stamp: "s" };

test("Ctrl on Windows and Linux, Cmd on a Mac, is the toggle click", () => {
  expect(isToggleClick({ ctrlKey: true, metaKey: false }, false)).toBe(true);
  expect(isToggleClick({ ctrlKey: false, metaKey: true }, false)).toBe(false);
  expect(isToggleClick({ ctrlKey: false, metaKey: true }, true)).toBe(true);
  expect(isToggleClick({ ctrlKey: true, metaKey: false }, true)).toBe(false);
});

test("a toggle-click leaves the rest of the selection in place", () => {
  let sel = clickRow([], "C:/a", true, same);
  sel = clickRow(sel, "C:/b", true, same);
  expect(sel).toEqual(["C:/a", "C:/b"]);
  expect(clickRow(sel, "c:/A", true, same)).toEqual(["C:/b"]);
});

test("a plain click on a third row selects only that row", () => {
  expect(clickRow(["C:/a", "C:/b"], "C:/c", false, same)).toEqual(["C:/c"]);
  expect(clickRow(["C:/a", "C:/b"], "C:/a", false, same)).toEqual(["C:/a"]);
});

test("two rows are covered by one confirmation", () => {
  const q = batchQuestion([
    { name: "one", check: clean },
    { name: "two", check: { ...clean, changes: [" M a.ts"] } },
  ]);
  expect(q.title).toBe("Remove 2 workspaces?");
  expect(q.removable).toEqual(["one", "two"]);
  expect(q.dirty).toEqual([{ name: "two", lines: [" M a.ts"], more: 0 }]);
  expect(q.blocked).toEqual([]);
});

test("a locked workspace is named as blocked, left out of the removal and stays selected", () => {
  const q = batchQuestion([
    { name: "one", check: clean },
    { name: "two", check: { ...clean, locked: "on a USB drive" } },
  ]);
  expect(q.blocked.map((b) => b.name)).toEqual(["two"]);
  expect(q.removable).toEqual(["one"]);
  expect(q.title).toBe("Remove one?");
  expect(selectionAfterDelete(q, ["C:/one", "C:/two"], (p) => p.slice(3))).toEqual(["C:/two"]);
});
