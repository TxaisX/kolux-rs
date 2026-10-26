// PROJ-063 box 1: an agent in a background workspace asking for permission makes that workspace's row
// show the permission state, ahead of other activity.
import { expect, test } from "vitest";
import { smartOrder, strongest, type AgentState, type RowInfo } from "../rows";

const row = (panes: AgentState[], changed: number): RowInfo => ({ state: strongest(panes), changed, pr: null });

test("a background workspace with a permission request shows permission, ahead of working, done and blocked panes", () => {
  // the row state is the strongest of the workspace's panes
  const background = row(["working", "done", "permission", "interrupted"], 100);
  expect(background.state).toBe("permission");
  const busy = row(["working", "working"], 999);
  const waiting = row(["blocked", "done"], 500);
  expect(busy.state).toBe("working");
  expect(waiting.state).toBe("blocked");
  const rows = { busy, background };
  // and the smart sort lists it above the busy one though it changed longest ago
  expect(smartOrder(Object.keys(rows), (k) => rows[k as keyof typeof rows])).toEqual(["background", "busy"]);
  // every other state ranks below it, whatever mix the panes are in
  for (const other of ["blocked", "waiting", "interrupted", "working", "queued", "done", "idle"] as AgentState[]) {
    expect(strongest([other, "permission"])).toBe("permission");
    expect(strongest(["permission", other])).toBe("permission");
  }
});
