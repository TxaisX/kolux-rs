// PROJ-050 boxes 1 and 2: smart sort puts a blocked workspace above a done one whichever changed last,
// and an interrupted agent's workspace never sorts among the done ones.
import { expect, test } from "vitest";
import { paneState, smartOrder, strongest, type AgentState, type RowInfo } from "../rows";

const row = (state: AgentState, changed: number): RowInfo => ({ state, changed, pr: null });

test("one workspace blocked and one done: blocked is above done, whichever changed last", () => {
  for (const [blockedAt, doneAt] of [[100, 900], [900, 100], [500, 500]]) {
    const rows = { done: row("done", doneAt), blocked: row("blocked", blockedAt) };
    const info = (k: string) => rows[k as keyof typeof rows];
    expect(smartOrder(["done", "blocked"], info)).toEqual(["blocked", "done"]);
    expect(smartOrder(["blocked", "done"], info)).toEqual(["blocked", "done"]);
  }
});

test("an interrupted agent's workspace is not sorted among the done ones, even when it changed first", () => {
  // the workspace's row state is the strongest of its panes' states
  const rows = {
    stopped: row(strongest(["interrupted"]), 10),
    finishedNew: row(strongest(["done"]), 990),
    finishedOld: row(strongest(["done"]), 500),
    mixed: row(strongest(["interrupted", "done"]), 20),
  };
  const order = smartOrder(Object.keys(rows), (k) => rows[k as keyof typeof rows]);
  expect(rows.stopped.state).toBe("interrupted");
  expect(order).toEqual(["mixed", "stopped", "finishedNew", "finishedOld"]);
  // an agent whose program ended without an interrupt is done, and stays among the done ones
  expect(paneState("claude", false)).toBe("done");
});
