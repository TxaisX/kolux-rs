import { expect, test } from "vitest";
import { checksSummary, NO_PR_GRACE_MS, reuseNoPr, stillRunning, type Check } from "./checks";

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
