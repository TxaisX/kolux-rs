import { expect, test } from "vitest";
import { checksSummary, hostUnlinked, NO_PR_GRACE_MS, reuseNoPr, showing, stillRunning, unlinkedPrs, withUnlinkedPr, type Check } from "./checks";

const c = (name: string, outcome: Check["outcome"]): Check => ({ name, outcome });

test("VIEW-073: the summary counts the worst first, and a PR with no checks says so", () => {
  expect(checksSummary([c("a", "passed"), c("b", "running"), c("c", "failed"), c("d", "unresolved"), c("e", "passed")])).toBe("1 failed · 1 unresolved · 1 running · 2 passed");
  expect(checksSummary([])).toBe("No checks have reported on this pull request.");
});

test("VIEW-073: polling goes on only while a check is still running; an unresolved one is finished", () => {
  expect(stillRunning([c("a", "passed"), c("b", "running")])).toBe(true);
  expect(stillRunning([c("a", "passed"), c("b", "unresolved"), c("c", "failed")])).toBe(false);
});

test("VIEW-073: a recent no-pull-request answer is reused for a short grace period, then asked again", () => {
  const seen = new Map<string, number>([["G:/ws/lead", 1000]]);
  expect(reuseNoPr(seen, "G:/ws/lead", 1000 + NO_PR_GRACE_MS - 1)).toBe(true);
  expect(reuseNoPr(seen, "G:/ws/lead", 1000 + NO_PR_GRACE_MS)).toBe(false);
  expect(reuseNoPr(seen, "G:/ws/helper", 1001)).toBe(false);
});

const pr = (number: number, state = "OPEN") => ({ number, url: `https://github.com/o/r/pull/${number}`, state });

test("VIEW-073: a pull request the host reports as unlinked is hidden, whatever case it says it in", () => {
  expect(hostUnlinked(pr(1, "UNLINKED"))).toBe(true);
  expect(hostUnlinked(pr(1, "Unlinked"))).toBe(true);
  expect(hostUnlinked(pr(1))).toBe(false);
  expect(hostUnlinked(null)).toBe(false);
  expect(showing(pr(1, "UNLINKED"), undefined)).toEqual({ kind: "none" });
  // The host's word beats the user's notice: nothing is shown, not even the notice.
  expect(showing(pr(1, "UNLINKED"), { number: 1, url: "u" })).toEqual({ kind: "none" });
  expect(showing(null, undefined)).toEqual({ kind: "none" });
});

test("VIEW-073: a pull request the user unlinked stays hidden behind a notice naming it; a different one shows", () => {
  const gone = { number: 7, url: "https://github.com/o/r/pull/7" };
  expect(showing(pr(7), gone)).toEqual({ kind: "unlinked", pr: gone });
  expect(showing(pr(8), gone)).toEqual({ kind: "pr", pr: pr(8) });
  expect(showing(pr(7), undefined)).toEqual({ kind: "pr", pr: pr(7) });
  // No pull request now: the old notice is stale, so the tab says there is no review.
  expect(showing(null, gone)).toEqual({ kind: "none" });
});

test("VIEW-073: the unlinked map keeps only well-formed entries and sets or clears one worktree", () => {
  expect(unlinkedPrs({ "G:/a": { number: 3, url: "u" }, "G:/b": { number: "x" }, "G:/c": null, "G:/d": 4 })).toEqual({ "G:/a": { number: 3, url: "u" } });
  expect(unlinkedPrs("x")).toEqual({});
  expect(unlinkedPrs([1])).toEqual({});
  const one = withUnlinkedPr({}, "G:/a", { number: 3, url: "u" });
  expect(one).toEqual({ "G:/a": { number: 3, url: "u" } });
  expect(withUnlinkedPr(one, "G:/a", null)).toEqual({});
  expect(one).toEqual({ "G:/a": { number: 3, url: "u" } }); // the old map is untouched
});
