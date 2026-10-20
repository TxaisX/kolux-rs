import { describe, expect, it } from "vitest";
import { cellsOf } from "../terminal/grid";
import { moveToTab, neighbourCell, tidyWeights } from "./tidy";

type P = { key: number; cwd: string | null; group?: number; run?: string };
const p = (key: number, group?: number, cwd: string | null = "/w", run = `run-${key}`): P => ({ key, cwd, run, ...(group === undefined ? {} : { group }) });
const shape = (panes: P[]) => cellsOf(panes).map((c) => c.panes.map((x) => x.key));

describe("term-008 tidy the grid", () => {
  const dragged = { "/w|col|3": [3, 1, 1], "/w|row|1": [1], "/w|col|2": [1, 4], "/other|col|3": [2, 1, 1] };
  it("every dragged size of this folder is dropped, whatever the pane count was", () => {
    expect(tidyWeights(dragged, "/w")).toEqual({ "/other|col|3": [2, 1, 1] });
  });
  it("a folder with nothing dragged changes nothing, and the input is not touched", () => {
    expect(tidyWeights(dragged, "/none")).toEqual(dragged);
    expect(dragged["/w|col|3"]).toEqual([3, 1, 1]);
  });
  it("the no-folder grid keys on the empty name", () => {
    expect(tidyWeights({ "|col|2": [1, 3], "/w|col|2": [1, 3] }, null)).toEqual({ "/w|col|2": [1, 3] });
  });
});

describe("term-016 move a pane out into its own tab", () => {
  const four = [p(1), p(2), p(3), p(4)];
  it("the pane becomes a tab of the cell before it and the grid shrinks by one cell", () => {
    const r = moveToTab(four, 3);
    expect(shape(r!.panes)).toEqual([[1], [2, 3], [4]]);
    expect(r!.group).toBe(2);
  });
  it("the first pane goes into the cell after it", () => {
    expect(shape(moveToTab(four, 1)!.panes)).toEqual([[2, 1], [3], [4]]);
  });
  it("nothing restarts: the same keys, the same runs, none twice", () => {
    let cur = four;
    for (const k of [3, 4, 2]) cur = moveToTab(cur, k)?.panes ?? cur;
    expect(cur.map((x) => x.key).sort()).toEqual([1, 2, 3, 4]);
    expect(cur.map((x) => x.run).sort()).toEqual(["run-1", "run-2", "run-3", "run-4"]);
    expect(new Set(cur.map((x) => x.key)).size).toBe(4);
  });
  it("a lone pane has no neighbour; a pane in another folder is not a neighbour", () => {
    expect(moveToTab([p(1)], 1)).toBeNull();
    expect(neighbourCell([p(1, undefined, "/a"), p(2, undefined, "/b")], 1)).toBeNull();
    expect(moveToTab([p(9)], 7)).toBeNull();
  });
  it("a tab of a shared cell moves with its own key, the others stay", () => {
    const r = moveToTab([p(1), p(2, 1), p(3)], 3);
    expect(shape(r!.panes)).toEqual([[1, 2, 3]]);
  });
});
