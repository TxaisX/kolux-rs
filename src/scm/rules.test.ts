import { expect, test } from "vitest";
import { emptyStatus, type Status } from "./model";
import { afterRefresh, aiControlsShown, commitBox, failureSummary, genDefaultsOf, mainStep, statusGuard, windowRange } from "./rules";

const ch = (path: string, status = "M") => ({ path, status, from: null });
const pushed: Status = { ...emptyStatus, branch: "feat", upstream: "origin/feat", base: "origin/main" };
const noPr = { loading: false, pr: null, error: null };

test("VIEW-062: only the visible part of a long list is drawn, with padding for the rest", () => {
  const w = windowRange(10_000, 3_000, 400, 20, 5);
  expect(w.start).toBe(145);
  expect(w.end).toBe(175);
  expect(w.padTop).toBe(145 * 20);
  expect(w.padBottom).toBe((10_000 - 175) * 20);
  expect(windowRange(0, 0, 400, 20)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
  expect(windowRange(3, 9_999, 400, 20).end).toBe(3);
});

test("VIEW-062: an older status answer never overwrites a newer one", () => {
  const g = statusGuard();
  const slow = g.begin();
  const fast = g.begin();
  expect(g.accept(fast)).toBe(true);
  expect(g.accept(slow)).toBe(false);
  const later = g.begin();
  expect(g.accept(later)).toBe(true);
});

test("VIEW-062: a failed automatic refresh keeps the last good status; a manual one shows the failure", () => {
  expect(afterRefresh(pushed, { error: "git busy" }, true)).toEqual({ status: pushed, error: "git busy" });
  expect(afterRefresh(pushed, { error: "git busy" }, false)).toEqual({ status: null, error: "git busy" });
  expect(afterRefresh(null, pushed, true)).toEqual({ status: pushed, error: null });
});

test("VIEW-064: a failed commit is one line; a lint failure is named, not the tool's wall of output", () => {
  const lint = failureSummary("husky - pre-commit hook\n> eslint .\n\n/src/a.ts\n  3:1  error  no-unused-vars\n\n\u2716 4 problems (4 errors, 0 warnings)\nlint-staged failed");
  expect(lint).toEqual({ summary: "The lint step of the commit hooks failed: 4 problems", lint: true, details: true });
  expect(failureSummary("eslint found 1 error").summary).toBe("The lint step of the commit hooks failed: 1 problem");
  expect(failureSummary("prettier failed").summary).toBe("The lint step of the commit hooks failed");
  const plain = failureSummary("error: gpg failed to sign the data\nfatal: failed to write commit object");
  expect(plain).toEqual({ summary: "gpg failed to sign the data", lint: false, details: true });
  expect(failureSummary("nothing added to commit")).toEqual({ summary: "nothing added to commit", lint: false, details: false });
  expect(failureSummary("   ").details).toBe(false);
  expect(failureSummary("x".repeat(300)).summary.length).toBe(140);
});

test("VIEW-064: during conflicts or an operation the box is disabled and the commit controls are hidden", () => {
  expect(commitBox(pushed)).toEqual({ boxDisabled: false, controlsHidden: false, why: null });
  expect(commitBox({ ...pushed, conflicts: [ch("c", "X")] })).toMatchObject({ boxDisabled: true, controlsHidden: true });
  expect(commitBox({ ...pushed, operation: "merge" })).toEqual({ boxDisabled: true, controlsHidden: true, why: "A merge is in progress" });
  expect(commitBox(null).boxDisabled).toBe(false);
});

test("VIEW-064: saved generation defaults are read per repository, else for all", () => {
  const claude = { agent: "claude", model: "opus", effort: "high" };
  const codex = { agent: "codex", model: null, effort: null };
  const d = genDefaultsOf({ all: claude, repos: { r1: codex } });
  expect(d.repos.r1).toEqual(codex);
  expect(d.all).toEqual(claude);
  expect(genDefaultsOf(JSON.parse(JSON.stringify(d)))).toEqual(d);
  expect(genDefaultsOf({ all: 3, repos: { x: "no" } })).toEqual({ all: null, repos: {} });
});

test("VIEW-065: equivalent patches steer to Create PR with Force Push left in the commit area", () => {
  const rewritten: Status = { ...pushed, ahead: 2, behind: 2, rewritten: true };
  const base = { label: "Force push with lease", action: "force" as const, reason: null };
  expect(mainStep(base, rewritten, noPr)).toEqual({ step: { label: "Create pull request", action: "pr", reason: null }, forceInCommitArea: true });
  const open = { loading: false, pr: { number: 7, url: "u", state: "OPEN" }, error: null };
  expect(mainStep(base, rewritten, open).step.label).toBe("Open pull request #7");
  expect(mainStep(base, { ...rewritten, changed: [ch("a")] }, noPr).step).toBe(base);
});

test("VIEW-065: a detached HEAD never offers Publish, but offers Create PR when a compare base is known", () => {
  const detached: Status = { ...pushed, branch: null, upstream: null };
  const publish = { label: "Publish branch", action: "publish" as const, reason: "HEAD is detached" };
  expect(mainStep(publish, detached, noPr).step).toEqual({ label: "Create pull request", action: "pr", reason: null });
  expect(mainStep(publish, { ...detached, base: null }, noPr).step.reason).toContain("no compare base");
  expect(mainStep(publish, detached, noPr).step.action).not.toBe("publish");
});

test("VIEW-065: Create PR waits while a newer readiness check is still loading", () => {
  const loading = { loading: true, pr: null, error: null };
  expect(mainStep({ label: "Create pull request", action: "pr", reason: null }, { ...pushed, rewritten: true }, loading).step.reason).toBe("Checking for a pull request");
});

test("VIEW-070: AI controls hide with the setting", () => {
  expect(aiControlsShown({})).toBe(true);
  expect(aiControlsShown({ scmAiHidden: true })).toBe(false);
  expect(aiControlsShown(null)).toBe(true);
});
