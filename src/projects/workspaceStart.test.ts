import { expect, test } from "vitest";
import { startPanes } from "./workspaceStart";

test("T-569: a workspace with no pane starts with one chooser (seats, no program), not a terminal", () => {
  let k = 5;
  const [only, ...rest] = startPanes("G:\Dev\demo", "main", 1, () => k++);
  expect(rest).toEqual([]);
  expect([only.key, only.cwd, only.branch, only.program]).toEqual([5, "G:\Dev\demo", "main", null]);
  expect(only.seats).toHaveLength(1);
  expect(only.seats![0]).toEqual({ agent: null, model: null });
});

test("T-569: a fresh workspace gets one chooser per default pane, each with its own key; a count under one still gives one", () => {
  let k = 1;
  expect(startPanes("d", null, 3, () => k++).map((p) => p.key)).toEqual([1, 2, 3]);
  expect(startPanes("d", null, 0, () => k++)).toHaveLength(1);
});
