// The pane grid's arithmetic (TERM-001, TERM-004, TERM-006), pure so it runs without a browser.
import { expect, test } from "vitest";
import { clampCount, columnsFor, insertShown, MAX_PANES, resizePlan, rowsFor, splitIndex } from "./grid";

const started = (key: number) => ({ key, started: true });
const empty = (key: number) => ({ key, started: false });

test("TERM-001: the count is clamped to 1..12; 13 panes yields 12", () => {
  expect(clampCount(13)).toBe(12);
  expect(clampCount(0)).toBe(1);
  expect(clampCount(-3)).toBe(1);
  expect(clampCount(6.7)).toBe(6);
  expect(clampCount(Number.NaN)).toBe(1);
  expect(MAX_PANES).toBe(12);
});

test("TERM-001: 4 to 6 adds 2 empty panes and leaves the 4 running sessions untouched", () => {
  const four = [1, 2, 3, 4].map(started);
  expect(resizePlan(four, 6)).toEqual({ add: 2, drop: [] });
});

test("TERM-001: 6 to 4 with 2 unstarted panes removes those 2, newest first, and never a started one", () => {
  const six = [started(1), empty(2), started(3), started(4), empty(5), started(6)];
  expect(resizePlan(six, 4)).toEqual({ add: 0, drop: [5, 2] });
  expect(resizePlan(six, 5)).toEqual({ add: 0, drop: [5] });
  // Only started sessions left: nothing is dropped (the ask comes with TERM-003).
  expect(resizePlan([1, 2, 3].map(started), 1)).toEqual({ add: 0, drop: [] });
  expect(resizePlan(six, 20)).toEqual({ add: 6, drop: [] });
  expect(resizePlan(six, 6)).toEqual({ add: 0, drop: [] });
});

test("TERM-004: balanced rows for one, two, four, six, nine and twelve panes", () => {
  const shape = (n: number) => [columnsFor(n), rowsFor(n)];
  expect(shape(1)).toEqual([1, 1]);
  expect(shape(2)).toEqual([2, 1]);
  expect(shape(3)).toEqual([2, 2]);
  expect(shape(4)).toEqual([2, 2]);
  expect(shape(6)).toEqual([3, 2]);
  expect(shape(9)).toEqual([3, 3]);
  expect(shape(12)).toEqual([4, 3]);
  expect(shape(0)).toEqual([1, 1]);
});

test("TERM-006: split right lands next to the pane, split down in the cell below", () => {
  const keys = [1, 2, 3, 4, 5, 6];
  expect(splitIndex(keys, 2, "right", 3)).toBe(2);
  expect(splitIndex(keys, 2, "down", 3)).toBe(4);
  expect(splitIndex(keys, 6, "right", 3)).toBe(6);
  expect(splitIndex(keys, 6, "down", 3)).toBe(6);
  expect(splitIndex(keys, 99, "right", 3)).toBe(6);
});

test("TERM-004/006: inserting into the shown list keeps every pane in order and hidden panes untouched", () => {
  const panes = [
    { key: 1, cwd: null },
    { key: 2, cwd: "C:\\a" },
    { key: 3, cwd: "C:\\b" },
    { key: 4, cwd: "C:\\a" },
  ];
  const fresh = { key: 9, cwd: "C:\\a" };
  expect(insertShown(panes, "C:\\a", 1, fresh).map((p) => p.key)).toEqual([1, 2, 3, 9, 4]);
  expect(insertShown(panes, "C:\\a", 2, fresh).map((p) => p.key)).toEqual([1, 2, 3, 4, 9]);
  expect(insertShown(panes, "C:\\a", 0, fresh).map((p) => p.key)).toEqual([1, 9, 2, 3, 4]);
});
