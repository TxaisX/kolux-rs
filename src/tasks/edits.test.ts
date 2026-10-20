import { expect, test } from "vitest";
import { applyEdits, EDIT_TTL_MS, editAssign, editState, leavesFilter, settle, undoAssign, undoState, wantedState, withAssignees } from "./edits";
import type { Task } from "./model";

const task = (n: number, over: Partial<Task> = {}): Task => ({ kind: "issue", number: n, title: `t${n}`, url: `https://github.com/o/r/issues/${n}`, repo: "o/r", state: "open", draft: false, labels: [], assignees: [], updated: "2026-10-10T00:00:00Z", checks: null, ...over });

test("GIT-048: two quick assignee edits are both kept, and the opposite edit cancels the first", () => {
  const url = task(1).url;
  let e = editAssign({}, url, ["ann"], [], 1000);
  e = editAssign(e, url, ["bob"], [], 1001);
  expect(applyEdits([task(1)], e)[0].assignees).toEqual(["ann", "bob"]);
  e = editAssign(e, url, [], ["ann"], 1002);
  expect(e[url].add).toEqual(["bob"]);
  expect(e[url].remove).toEqual(["ann"]);
  expect(withAssignees(["ann", "cy"], e[url])).toEqual(["cy", "bob"]);
});

test("GIT-048: a late search answer with the old value does not undo a confirmed change", () => {
  const url = task(2).url;
  const e = editState(editAssign({}, url, ["ann"], [], 5), url, "closed", 5);
  const stale = [task(2)];
  const shown = applyEdits(stale, e)[0];
  expect([shown.state, shown.assignees]).toEqual(["closed", ["ann"]]);
  // the stale answer keeps the edit alive; an answer that agrees retires it
  expect(Object.keys(settle(e, stale, 10))).toEqual([url]);
  expect(settle(e, [task(2, { state: "closed", assignees: ["ann", "zed"] })], 10)).toEqual({});
  // a half-agreeing answer keeps the whole edit
  expect(Object.keys(settle(e, [task(2, { state: "closed" })], 10))).toEqual([url]);
});

test("GIT-048: a failed write is rolled back by itself; the other pending edits stay", () => {
  const url = task(3).url;
  let e = editAssign({}, url, ["ann"], [], 1);
  e = editAssign(e, url, ["bob"], [], 2);
  e = undoAssign(e, url, ["bob"], []);
  expect(e[url].add).toEqual(["ann"]);
  e = editState(e, url, "closed", 3);
  e = undoState(e, url);
  expect(applyEdits([task(3)], e)[0]).toMatchObject({ state: "open", assignees: ["ann"] });
  expect(undoAssign({}, url, ["x"], [])).toEqual({});
  expect(undoState({}, url)).toEqual({});
});

test("GIT-048: an edit that nothing confirmed expires, and an item GitHub no longer returns keeps its edit until then", () => {
  const url = task(4).url;
  const e = editState({}, url, "closed", 1000);
  expect(Object.keys(settle(e, [], 1000 + EDIT_TTL_MS))).toEqual([url]);
  expect(settle(e, [], 1001 + EDIT_TTL_MS)).toEqual({});
  expect(settle({ [url]: { add: [], remove: [], at: 1000 } }, [task(4)], 1001)).toEqual({});
});

test("GIT-048: an item that stops matching the state filter fades out; no state in the filter fades nothing", () => {
  expect(wantedState(["is:issue", "is:open", "sort:updated"])).toBe("open");
  expect(wantedState(["state:Closed"])).toBe("closed");
  expect(wantedState(["is:pr", "label:bug"])).toBeNull();
  expect(leavesFilter({ state: "closed" }, "open")).toBe(true);
  expect(leavesFilter({ state: "open" }, "open")).toBe(false);
  expect(leavesFilter({ state: "merged" }, "closed")).toBe(false);
  expect(leavesFilter({ state: "open" }, "closed")).toBe(true);
  expect(leavesFilter({ state: "open" }, "merged")).toBe(true);
  expect(leavesFilter({ state: "closed" }, null)).toBe(false);
});
