import { expect, test } from "vitest";
import { groupRows, jumpUnhides, paneState, smartOrder, sortFromSetting, strongest, withoutAutomationMade, type RowInfo } from "./rows";

const at = (state: RowInfo["state"], changed: number, pr: RowInfo["pr"] = null): RowInfo => ({ state, changed, pr });

test("a row shows the strongest live state among its panes, a permission request first (PROJ-063)", () => {
  expect(strongest(["working", "permission", "done"])).toBe("permission");
  expect(strongest(["done", "working"])).toBe("working");
  expect(strongest(["idle", "done"])).toBe("done");
  expect(strongest([])).toBe("idle");
  expect(paneState("shell", true)).toBe("idle");
  expect(paneState("claude", undefined)).toBe("working");
  expect(paneState("claude", false)).toBe("done");
});

test("smart sort: needs-you first, then done, working, idle; newest change on top within a class (PROJ-050)", () => {
  const rows = { done: at("done", 900), blocked: at("blocked", 100), working: at("working", 950), idle: at("idle", 999), waiting: at("waiting", 50), interrupted: at("interrupted", 10) };
  const order = smartOrder(Object.keys(rows), (k) => rows[k as keyof typeof rows]);
  expect(order).toEqual(["blocked", "waiting", "interrupted", "done", "working", "idle"]);
  // an interrupted agent is never among the done ones, whatever changed last
  expect(order.indexOf("interrupted")).toBeLessThan(order.indexOf("done"));
});

test("grouping: a merged pull request is done, a suppressed one in progress, queued stands alone (PROJ-045)", () => {
  const rows = { a: at("working", 1, "merged"), b: at("working", 2, "suppressed"), c: at("queued", 3, null), d: at("permission", 4, "open"), e: at("idle", 5, "closed") };
  const info = (k: string) => rows[k as keyof typeof rows];
  expect(groupRows(Object.keys(rows), "pr", info, () => "").map((g) => [g.title, g.rows])).toEqual([
    ["In progress", ["b", "d"]],
    ["Done", ["a"]],
    ["Closed", ["e"]],
    ["No pull request", ["c"]],
  ]);
  expect(groupRows(Object.keys(rows), "status", info, () => "").map((g) => [g.title, g.rows])).toEqual([
    ["Needs you", ["d"]],
    ["Working", ["a", "b"]],
    ["Queued", ["c"]],
    ["Idle", ["e"]],
  ]);
  expect(groupRows(["a", "b"], "project", info, (k) => (k === "a" ? "app" : "web")).map((g) => g.title)).toEqual(["app", "web"]);
  expect(groupRows(["a", "b"], "none", info, () => "x")).toEqual([{ title: "", rows: ["a", "b"] }]);
});

test("the sort setting: Smart by default, and an old Recent choice is moved over to Smart", () => {
  expect(sortFromSetting(undefined)).toBe("smart");
  expect(sortFromSetting("recent")).toBe("smart");
  expect(sortFromSetting("name")).toBe("name");
  expect(sortFromSetting("bogus")).toBe("smart");
});

test("AUTO-024: the switch hides worktrees made by automations, and jumping to one turns it off", () => {
  const run = { path: "C:/r/wts/otter", madeBy: "automation" };
  const hand = { path: "C:/r/wts/lead", madeBy: "app" };
  const lists = { p1: [run, hand, { path: "C:/r", madeBy: null }] };
  expect(withoutAutomationMade(lists, true).p1.map((w) => w.path)).toEqual(["C:/r/wts/lead", "C:/r"]);
  expect(withoutAutomationMade(lists, false)).toBe(lists);
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  // Moving to a hidden run worktree turns the switch off; staying on it, or the switch off, does nothing.
  expect(jumpUnhides("C:/r/wts/lead", "c:/R/wts/otter", lists, true, same)).toBe(true);
  expect(jumpUnhides("C:/r/wts/otter", "C:/r/wts/otter", lists, true, same)).toBe(false);
  expect(jumpUnhides("C:/r/wts/lead", "C:/r/wts/otter", lists, false, same)).toBe(false);
  expect(jumpUnhides("C:/r/wts/otter", "C:/r/wts/lead", lists, true, same)).toBe(false);
  expect(jumpUnhides(null, null, lists, true, same)).toBe(false);
});
