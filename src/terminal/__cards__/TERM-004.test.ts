// TERM-004 acceptance: balanced rows for 1/2/4/6/9/12 panes, every pane kept in order, no restart.
import { expect, test } from "vitest";
import { cellsOf, columnsFor, insertBefore, resizePlan, rowsFor, splitIndex } from "../grid";

type P = { key: number; cwd: string };
const mk = (n: number): P[] => Array.from({ length: n }, (_, i) => ({ key: i + 1, cwd: "C:\\w" }));
const PRESETS = [1, 2, 4, 6, 9, 12];

test("box 1 (model part): applying a preset to as many running sessions adds and drops nothing, the same panes stay in place", () => {
  for (const n of PRESETS) {
    const panes = mk(n);
    const cells = cellsOf(panes).map((c) => ({ key: c.group, started: true }));
    expect(resizePlan(cells, n)).toEqual({ add: 0, drop: [] });
    const after = cellsOf(panes);
    after.forEach((c, i) => expect(c.panes[0]).toBe(panes[i])); // same objects, so same keys, so the mounted terminals stay
  }
});

test("box 2: after any re-arrangement every pane is still present, in its original order", () => {
  let seed = 4;
  const rnd = (n: number) => (seed = (seed * 48271) % 2147483647) % n;
  for (let round = 0; round < 40; round++) {
    let panes = mk(1 + rnd(4));
    let key = 100;
    for (let step = 0; step < 8; step++) {
      const before = panes.map((p) => p.key);
      if (panes.length < 12) {
        // a split (right or down) from a random pane
        const shown = cellsOf(panes);
        const src = shown[rnd(shown.length)];
        const dir = rnd(2) ? "right" : "down";
        const stack = dir === "down" && shown.length === 1;
        const at = splitIndex(shown.map((c) => c.group), src.group, dir, columnsFor(shown.length + 1, stack));
        panes = insertBefore(panes, shown[at]?.panes[0], { key: key++, cwd: "C:\\w" });
      }
      // every earlier pane is still there, in the order it had
      expect(panes.map((p) => p.key).filter((k) => before.includes(k))).toEqual(before);
      // the arranged grid holds exactly the panes: nothing lost, nothing doubled
      const cells = cellsOf(panes);
      expect(cells.flatMap((c) => c.panes.map((p) => p.key))).toEqual(panes.map((p) => p.key));
      expect(columnsFor(cells.length) * rowsFor(cells.length)).toBeGreaterThanOrEqual(cells.length);
    }
  }
});

test("box 2: a resize to a preset keeps the surviving panes in order and loses none but unstarted ones", () => {
  for (const to of PRESETS) {
    const panes = mk(7).map((p, i) => ({ ...p, started: i % 2 === 0 })); // 1,3,5,7 started
    const { add, drop } = resizePlan(panes.map((p) => ({ key: p.key, started: p.started })), to);
    const kept = panes.filter((p) => !drop.includes(p.key));
    expect(drop.every((k) => !panes.find((p) => p.key === k)?.started)).toBe(true);
    expect(kept.map((p) => p.key)).toEqual(panes.map((p) => p.key).filter((k) => !drop.includes(k)));
    expect(kept.length + add).toBeGreaterThanOrEqual(Math.min(to, 7));
  }
});

test("rows are balanced for the preset counts", () => {
  const shape = PRESETS.map((n) => [columnsFor(n), rowsFor(n)]);
  expect(shape).toEqual([[1, 1], [2, 1], [2, 2], [3, 2], [3, 3], [4, 3]]);
});
