import { expect, test } from "vitest";
import { sessionOrder } from "./restoreOrder";

const pane = (key: number, cwd: string) => ({ key, cwd });

test("VIEW-107: tabs saved out of order come back in the order they were opened, across workspaces", () => {
  const saved = [pane(5, "C:/b"), pane(2, "C:/a"), pane(9, "C:/a"), pane(1, "C:/b"), pane(7, "C:/c")];
  expect(sessionOrder(saved).map((p) => p.key)).toEqual([1, 2, 5, 7, 9]);
  // each workspace's own tabs are in that order too
  expect(sessionOrder(saved).filter((p) => p.cwd === "C:/a").map((p) => p.key)).toEqual([2, 9]);
  expect(saved.map((p) => p.key)).toEqual([5, 2, 9, 1, 7]); // the saved list itself is not changed
});

test("VIEW-107: a layout already in session order is returned as it is, and equal keys keep their saved order", () => {
  const ordered = [pane(1, "C:/a"), pane(2, "C:/b"), pane(2, "C:/c"), pane(4, "C:/a")];
  expect(sessionOrder(ordered)).toBe(ordered);
  const tied = [pane(3, "C:/x"), pane(2, "C:/y"), pane(2, "C:/z")];
  expect(sessionOrder(tied).map((p) => p.cwd)).toEqual(["C:/y", "C:/z", "C:/x"]);
  expect(sessionOrder([])).toEqual([]);
});
