// TERM-044 / TERM-049: closing tabs in bulk and where focus goes afterwards.
import { expect, test } from "vitest";
import { closeSet, returnTab } from "./tabClose";

const order = [11, 12, 13, 14];

test("TERM-044: the bulk close items name the tabs in visible order and are empty when nothing would close", () => {
  expect(closeSet(order, 12, "one")).toEqual([12]);
  expect(closeSet(order, 12, "others")).toEqual([11, 13, 14]);
  expect(closeSet(order, 12, "right")).toEqual([13, 14]);
  expect(closeSet(order, 12, "left")).toEqual([11]);
  expect(closeSet(order, 12, "all")).toEqual([11, 12, 13, 14]);
  // Close to the right on the last tab, and to the left on the first, have nothing to close.
  expect(closeSet(order, 14, "right")).toEqual([]);
  expect(closeSet(order, 11, "left")).toEqual([]);
  expect(closeSet([11], 11, "others")).toEqual([]);
  // A tab that is not in the strip closes nothing.
  expect(closeSet(order, 99, "others")).toEqual([]);
});

test("TERM-044: closing the active tab returns to the tab used before it, else its right neighbour, else the left one", () => {
  // 13 was used just before 12 (the recent list is newest first).
  expect(returnTab(order, [12], [12, 13, 11])).toBe(13);
  // The previous tab is closing too: fall through to the next recent survivor.
  expect(returnTab(order, [12, 13], [12, 13, 11])).toBe(11);
  // No history: the right neighbour, skipping tabs that are closing.
  expect(returnTab(order, [12], [])).toBe(13);
  expect(returnTab(order, [12, 13], [])).toBe(14);
  // The last tab: the one on its left.
  expect(returnTab(order, [14], [])).toBe(13);
  // Everything closes: nowhere to go.
  expect(returnTab(order, order, [12, 13])).toBeNull();
  // History from another strip is ignored.
  expect(returnTab(order, [12], [77])).toBe(13);
});
