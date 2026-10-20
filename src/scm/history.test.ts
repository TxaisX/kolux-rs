import { expect, test } from "vitest";
import { HistoryLoads, acceptHistory, historyFor } from "./history";
import type { Commit } from "./model";

const c = (subject: string): Commit => ({ hash: subject, short: subject, parents: [], author: "a", time: 0, subject, message: subject, labels: [], outgoing: false, incoming: false });

test("VIEW-071 a slow load never replaces a newer one", () => {
  const loads = new HistoryLoads();
  const slow = loads.begin();
  const fast = loads.begin();
  let shown = acceptHistory(loads, fast, "/a", [c("new")], null);
  shown = acceptHistory(loads, slow, "/a", [c("old")], shown);
  expect(historyFor(shown, "/a")?.map((x) => x.subject)).toEqual(["new"]);
});

test("VIEW-071 after switching worktrees the previous worktree's commits are never drawn, even before they are cleared", () => {
  const loads = new HistoryLoads();
  const a = loads.begin();
  const shown = acceptHistory(loads, a, "/a", [c("commit in a")], null);
  expect(historyFor(shown, "/b")).toBeNull();
  expect(historyFor(shown, null)).toBeNull();
  // The answer for the old worktree arrives after the switch: a newer load has begun, so it is dropped.
  const b = loads.begin();
  const late = acceptHistory(loads, a, "/a", [c("late a")], shown);
  expect(late).toBe(shown);
  expect(historyFor(acceptHistory(loads, b, "/b", [c("commit in b")], late), "/b")?.[0].subject).toBe("commit in b");
});

test("VIEW-071 a commit made in the worktree shows at the top of its fresh list", () => {
  const loads = new HistoryLoads();
  const first = acceptHistory(loads, loads.begin(), "/a", [c("one")], null);
  const next = acceptHistory(loads, loads.begin(), "/a", [c("two"), c("one")], first);
  expect(historyFor(next, "/a")?.[0].subject).toBe("two");
});
