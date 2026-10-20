import { beforeEach, expect, test } from "vitest";
import { paletteRows } from "../projects/WorktreePalette";
import type { Check } from "./checks";
import { applyChecks, applyPoll, checkLine, getKnown, needChecks, prItems, recordChecks, recordPoll, resetKnown, type KnownPrs } from "./prSearch";

const pr = (number: number, title: string, state = "OPEN") => ({ number, url: `https://github.com/o/r/pull/${number}`, state, title, head: `b${number}` });
const check = (outcome: Check["outcome"]): Check => ({ name: "x", outcome });
const round = (...prs: { path: string; pr: ReturnType<typeof pr> | null; error?: string | null; linked?: boolean }[]) => ({ prs: prs.map((p) => ({ linked: false, error: null, ...p })), limitedUntil: null });

beforeEach(resetKnown);

test("VIEW-043: a known number lists its pull request with the check state from the Checks panel", () => {
  let k: KnownPrs = applyPoll({}, round({ path: "G:/a", pr: pr(12, "Fix the poller") }));
  expect(prItems(k, () => {})[0].hint).toBe("Open · checks not read yet");
  k = applyChecks(k, "G:/a", { pr: pr(12, "Fix the poller"), conflict: false, checks: [check("passed"), check("passed"), check("failed")] }, 5);
  const rows = paletteRows(prItems(k, () => {}), "12");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ label: "#12 Fix the poller", hint: "Open · 1 failed · 2 passed", number: 12 });
  expect(paletteRows(prItems(k, () => {}), "poller")).toHaveLength(1);
  expect(paletteRows(prItems(k, () => {}), "13")).toHaveLength(0);
});

test("VIEW-043: the row's go runs with the workspace path", () => {
  const seen: string[] = [];
  const k = applyPoll({}, round({ path: "G:/a", pr: pr(3, "T") }));
  prItems(k, (p) => seen.push(p))[0].run();
  expect(seen).toEqual(["G:/a"]);
});

test("VIEW-043: a pull request the host reports as unlinked is not listed from an older result", () => {
  let k = applyPoll({}, round({ path: "G:/a", pr: pr(12, "Old") }, { path: "G:/b", pr: pr(7, "Seven") }));
  k = applyChecks(k, "G:/a", { pr: pr(12, "Old"), conflict: false, checks: [check("passed")] }, 5);
  // the host now answers with no pull request for a, and an error for b: a goes, b keeps its last row
  k = applyPoll(k, round({ path: "G:/a", pr: null }, { path: "G:/b", pr: null, error: "rate limit" }));
  expect(Object.keys(k)).toEqual(["G:/b"]);
  // the Checks panel saying "no pull request" removes the row too
  expect(Object.keys(applyChecks(k, "G:/b", { pr: null, conflict: false, checks: [] }, 9))).toEqual([]);
});

test("VIEW-043: checks of one pull request never stay on another that takes the workspace's place", () => {
  let k = applyPoll({}, round({ path: "G:/a", pr: pr(12, "Old") }));
  k = applyChecks(k, "G:/a", { pr: pr(12, "Old"), conflict: false, checks: [check("failed")] }, 5);
  k = applyPoll(k, round({ path: "G:/a", pr: pr(20, "New") }));
  expect(k["G:/a"]).toMatchObject({ checks: null, at: null, pr: { number: 20, title: "New" } });
  const swapped = applyChecks(k, "G:/a", { pr: { number: 21, url: "https://github.com/o/r/pull/21", state: "OPEN" }, conflict: false, checks: [] }, 6);
  expect(swapped["G:/a"].pr.title).toBeUndefined();
});

test("VIEW-043: check lines, and which open pull requests still need their checks read", () => {
  expect(checkLine([])).toBe("no checks");
  expect(checkLine([check("running"), check("passed")])).toBe("1 running · 1 passed");
  const k = applyPoll({}, round({ path: "G:/a", pr: pr(1, "A") }, { path: "G:/b", pr: pr(2, "B", "MERGED") }, { path: "G:/c", pr: pr(3, "C") }));
  const read = applyChecks(k, "G:/c", { pr: pr(3, "C"), conflict: false, checks: [] }, 1000);
  expect(needChecks(read, 1500, 60_000, 6).map((x) => x.path)).toEqual(["G:/a"]);
  expect(needChecks(read, 1500 + 60_000, 60_000, 6).map((x) => x.path)).toEqual(["G:/a", "G:/c"]);
  expect(needChecks(read, 0, 60_000, 0)).toEqual([]);
});

test("VIEW-043: the store takes the poll and the panel's answers", () => {
  recordPoll(round({ path: "G:/a", pr: pr(4, "Four") }));
  recordChecks("G:/a", { pr: pr(4, "Four"), conflict: false, checks: [check("passed")] });
  expect(getKnown()["G:/a"].checks).toHaveLength(1);
  recordPoll(round({ path: "G:/a", pr: null }));
  expect(getKnown()).toEqual({});
});
