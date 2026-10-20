import { expect, test } from "vitest";
import { attachedRows, resultOfChecks, rollup, rollupLine } from "./attachedTabs";
import type { Worktree } from "./model";

const wt = (path: string, parent: string | null, extra: Partial<Worktree> = {}): Worktree => ({ path, branch: path.split("/").pop()!, head: "x", isMain: false, parent, ...extra }) as Worktree;
const F = "C:/work/suite";

test("VIEW-076: both repos' worktrees are listed, and one made from an attached worktree two levels down sits under it", () => {
  const all = [wt("C:/w/a1", F), wt("C:/w/b1", F), wt("C:/w/a2", "C:/w/a1"), wt("C:/w/a3", "C:/w/a2"), wt("C:/w/other", null)];
  const rows = attachedRows(F, all);
  expect(rows.map((r) => [r.label, r.depth])).toEqual([["a1", 0], ["a2", 1], ["a3", 2], ["b1", 0]]);
});

test("VIEW-076: a name is shown over the branch, and a loop of parents is cut", () => {
  const rows = attachedRows(F, [wt("C:/w/a1", F, { name: " Login fix " }), wt("C:/w/x", "C:/w/y"), wt("C:/w/y", "C:/w/x")]);
  expect(rows.map((r) => r.label)).toEqual(["Login fix"]);
});

test("VIEW-076: an unlinked or missing pull request is left out of the rollup, a dismissed one too", () => {
  const ok = (state: string, outcome: "failed" | "passed", n = 1) => ({ pr: { number: n, url: "u", state }, conflict: false, checks: [{ name: "ci", outcome }] });
  expect(resultOfChecks(null)).toBeUndefined();
  expect(resultOfChecks({ pr: null, conflict: false, checks: [] })).toBeUndefined();
  expect(resultOfChecks(ok("UNLINKED", "failed"))).toBeUndefined();
  const all = [wt("C:/w/a1", F), wt("C:/w/a2", "C:/w/a1"), wt("C:/w/b1", F)];
  expect(rollup(F, all, { "C:/w/a1": ok("OPEN", "passed", 1), "C:/w/a2": ok("OPEN", "failed", 2), "C:/w/b1": ok("UNLINKED", "failed", 3) })).toBe("failing");
  expect(rollup(F, all, { "C:/w/a1": ok("OPEN", "passed", 1), "C:/w/a2": ok("OPEN", "failed", 2) }, new Set([2]))).toBe("passing");
  expect(rollup(F, all, {})).toBeNull();
  expect(rollupLine("failing")).toMatch(/^Failing/);
});
