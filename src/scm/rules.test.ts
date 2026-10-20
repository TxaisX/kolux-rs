import { expect, test } from "vitest";
import { emptyStatus, type Status } from "./model";
import {
  HUGE_REPO_FILES, afterRefresh, bigChangeBanner, commitBox, createBlockedReason, createEnabled, createFlow, dismissHuge, failureSummary, genDefault, genDefaultsOf, highlightRow, hugeWarning, mainStep,
  manualPrLink, openInSplit, aiControlsShown, recoveryPrompt, refreshGap, refreshOrder, remoteMoved, rowActions, runsAction, saveGenDefault, saveOffers, spinnerOn, stackMap, statusGuard, submoduleOnly,
  submoduleRows, toggleSub, windowRange,
} from "./rules";

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

test("VIEW-062: the huge-repo warning shows once past the limit and stays dismissed per repository", () => {
  expect(hugeWarning(HUGE_REPO_FILES - 1, {}, "a")).toBeNull();
  expect(hugeWarning(HUGE_REPO_FILES, {}, "a")).toContain("50,000 files");
  const gone = dismissHuge({}, "a");
  expect(hugeWarning(HUGE_REPO_FILES * 2, gone, "a")).toBeNull();
  expect(hugeWarning(HUGE_REPO_FILES * 2, gone, "b")).not.toBeNull();
  expect(bigChangeBanner(1_999)).toBeNull();
  expect(bigChangeBanner(2_500)).toContain("2,500 files changed");
});

test("VIEW-062: submodules list as rows that expand in place at their own folder", () => {
  const s: Status = { ...pushed, changed: [ch("libs/x")], submodules: { "libs/x": "new commits" } };
  const closed = submoduleRows(s, "C:/w", new Set());
  expect(closed).toEqual([{ path: "libs/x", detail: "new commits", open: false, dir: "C:/w/libs/x" }]);
  const open = toggleSub(new Set(), "libs/x");
  expect(submoduleRows(s, "C:/w", open)[0].open).toBe(true);
  expect(toggleSub(open, "libs/x").size).toBe(0);
  expect(submoduleRows(null, "C:/w", open)).toEqual([]);
});

test("VIEW-062: the active worktree refreshes first, then visible ones, then the rest, never twice", () => {
  expect(refreshOrder(["a", "b", "c", "d"], "c", ["d", "c", "zz"])).toEqual(["c", "d", "a", "b"]);
  expect(refreshOrder(["a", "b"], null, [])).toEqual(["a", "b"]);
  expect(refreshOrder(["a"], "gone", [])).toEqual(["a"]);
});

test("VIEW-062: a slow refresh waits longer, each failure doubles it, never past a minute", () => {
  expect(refreshGap(100, 0)).toBe(2_000);
  expect(refreshGap(5_000, 0)).toBe(15_000);
  expect(refreshGap(5_000, 1)).toBe(30_000);
  expect(refreshGap(5_000, 9)).toBe(60_000);
  expect(refreshGap(900_000, 0)).toBe(60_000);
});

test("VIEW-062: a push, pull or upstream move is a reason to refresh", () => {
  expect(remoteMoved(pushed, { ...pushed })).toBe(false);
  expect(remoteMoved(pushed, { ...pushed, ahead: 1 })).toBe(true);
  expect(remoteMoved(pushed, { ...pushed, upstream: "origin/other" })).toBe(true);
  expect(remoteMoved(pushed, { ...pushed, head: "abc" })).toBe(true);
  expect(remoteMoved(null, pushed)).toBe(false);
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

test("VIEW-062: an editing tab marks the working-tree row first, the staged row only without one; a compare tab marks none", () => {
  const both: Status = { ...pushed, staged: [ch("a.ts", "A")], changed: [ch("a.ts")] };
  expect(highlightRow({ kind: "edit", path: "a.ts" }, both)).toEqual({ section: "Changes", path: "a.ts" });
  expect(highlightRow({ kind: "edit", path: "a.ts" }, { ...both, changed: [] })).toEqual({ section: "Staged", path: "a.ts" });
  expect(highlightRow({ kind: "edit", path: "n.ts" }, { ...pushed, untracked: [ch("n.ts", "U")] })).toEqual({ section: "Untracked", path: "n.ts" });
  expect(highlightRow({ kind: "compare", path: "a.ts" }, both)).toBeNull();
  expect(highlightRow({ kind: "diff", path: "a.ts", staged: true }, both)).toEqual({ section: "Staged", path: "a.ts" });
  expect(highlightRow({ kind: "edit", path: "zzz" }, both)).toBeNull();
});

test("VIEW-063: Mod, Shift or Alt open a split, a plain click never does; Mod is Command on a Mac", () => {
  const e = { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };
  expect(openInSplit(e, false)).toBe(false);
  expect(openInSplit({ ...e, ctrlKey: true }, false)).toBe(true);
  expect(openInSplit({ ...e, metaKey: true }, false)).toBe(false);
  expect(openInSplit({ ...e, metaKey: true }, true)).toBe(true);
  expect(openInSplit({ ...e, ctrlKey: true }, true)).toBe(false);
  expect(openInSplit({ ...e, shiftKey: true }, false)).toBe(true);
  expect(openInSplit({ ...e, altKey: true }, true)).toBe(true);
});

test("VIEW-063: unavailable row actions keep their tooltip but ignore clicks", () => {
  const staged = rowActions("Staged");
  expect(staged.map((a) => [a.id, a.available])).toEqual([["stage", false], ["unstage", true], ["discard", true], ["open", true]]);
  const stage = staged[0];
  expect(stage.title).toBe("Already staged");
  expect(runsAction(stage)).toBe(false);
  expect(rowActions("Untracked")[2].label).toBe("Delete");
  const conflict = rowActions("Conflicts", false);
  expect(conflict[0]).toMatchObject({ available: false, title: "Resolve the clash markers first" });
  expect(conflict[2].available).toBe(false);
  expect(rowActions("Conflicts", true)[0].available).toBe(true);
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
  expect(recoveryPrompt(lint, "boom")).toContain("lint step of my commit hooks failed");
});

test("VIEW-064: only submodule pointers changed keeps Stage All as the main action", () => {
  const subs = { "libs/x": "new commits" };
  expect(submoduleOnly({ ...pushed, changed: [ch("libs/x")], submodules: subs })).toBe(true);
  expect(submoduleOnly({ ...pushed, changed: [ch("libs/x"), ch("a.ts")], submodules: subs })).toBe(false);
  expect(submoduleOnly({ ...pushed, staged: [ch("libs/x")], submodules: subs })).toBe(false);
  expect(submoduleOnly(null)).toBe(false);
});

test("VIEW-064: during conflicts or an operation the box is disabled and the commit controls are hidden", () => {
  expect(commitBox(pushed)).toEqual({ boxDisabled: false, controlsHidden: false, why: null });
  expect(commitBox({ ...pushed, conflicts: [ch("c", "X")] })).toMatchObject({ boxDisabled: true, controlsHidden: true });
  expect(commitBox({ ...pushed, operation: "merge" })).toEqual({ boxDisabled: true, controlsHidden: true, why: "A merge is in progress" });
  expect(commitBox(null).boxDisabled).toBe(false);
});

test("VIEW-064: generation defaults save per repository or for all, the save hides once it already is the default", () => {
  const claude = { agent: "claude", model: "opus", effort: "high" };
  const codex = { agent: "codex", model: null, effort: null };
  let d = genDefaultsOf(undefined);
  expect(saveOffers(d, "r1", claude)).toEqual({ repo: true, all: true });
  d = saveGenDefault(d, "all", "r1", claude);
  expect(saveOffers(d, "r1", claude)).toEqual({ repo: true, all: false });
  d = saveGenDefault(d, "repo", "r1", codex);
  expect(genDefault(d, "r1")).toEqual(codex);
  expect(genDefault(d, "r2")).toEqual(claude);
  expect(saveOffers(d, "r1", codex)).toEqual({ repo: false, all: true });
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

test("VIEW-065: Create PR waits for the newest readiness check; an older yes never enables it", () => {
  expect(createEnabled(2, { ticket: 1, ok: true })).toBe(false);
  expect(createEnabled(2, { ticket: 2, ok: true })).toBe(true);
  expect(createEnabled(2, { ticket: 2, ok: false })).toBe(false);
  expect(createEnabled(1, null)).toBe(false);
  const loading = { loading: true, pr: null, error: null };
  expect(mainStep({ label: "Create pull request", action: "pr", reason: null }, { ...pushed, rewritten: true }, loading).step.reason).toBe("Checking for a pull request");
});

test("VIEW-065: a dropdown push that is running puts the spinner on the arrow while the main button reads Commit", () => {
  const commit = { label: "Commit", action: "commit" as const, reason: null };
  const push = { label: "Push 2", action: "push" as const, reason: null };
  expect(spinnerOn("push", commit)).toBe("arrow");
  expect(spinnerOn("commit", commit)).toBe("main");
  expect(spinnerOn("push", push)).toBe("main");
  expect(spinnerOn("sync", push)).toBeNull();
  expect(spinnerOn(null, commit)).toBeNull();
});

test("VIEW-065: choosing Create PR carries through commit and push before the composer", () => {
  expect(createFlow({ ...pushed, staged: [ch("a", "A")] }, "msg")).toEqual(["commit", "push", "composer"]);
  expect(createFlow({ ...pushed, staged: [ch("a", "A")] }, " ")).toEqual([]);
  expect(createFlow({ ...pushed, ahead: 1 }, "")).toEqual(["push", "composer"]);
  expect(createFlow({ ...pushed, upstream: null }, "")).toEqual(["push", "composer"]);
  expect(createFlow(pushed, "")).toEqual(["composer"]);
  expect(createFlow(null, "x")).toEqual([]);
});

test("VIEW-070: the stack map orders a single chain from the trunk and refuses branching chains", () => {
  const a = { number: 1, head: "a", base: "main", state: "OPEN" };
  const b = { number: 2, head: "b", base: "a", state: "OPEN" };
  const c = { number: 3, head: "c", base: "b", state: "OPEN" };
  expect(stackMap([c, a, b], "main").map((p) => p.number)).toEqual([1, 2, 3]);
  expect(stackMap([a, { ...b, base: "main" }], "main")).toEqual([]);
  expect(stackMap([a, { ...c, base: "zzz" }], "main")).toEqual([]);
  expect(stackMap([], "main")).toEqual([]);
});

test("VIEW-070: the manual link names the fork owner with the branch so it targets the right repository", () => {
  const repo = { owner: "acme", name: "app" };
  expect(manualPrLink("github.com", repo, "main", "feat/x", null)).toBe("https://github.com/acme/app/compare/main...feat%2Fx?expand=1");
  expect(manualPrLink("github.com", repo, "main", "feat", "me")).toBe("https://github.com/acme/app/compare/main...me:feat?expand=1");
  expect(manualPrLink("github.com", repo, "main", "feat", "acme")).toBe("https://github.com/acme/app/compare/main...feat?expand=1");
});

test("VIEW-070: AI controls hide with the setting; creation is blocked with a reason until local state is ready", () => {
  expect(aiControlsShown({})).toBe(true);
  expect(aiControlsShown({ scmAiHidden: true })).toBe(false);
  expect(aiControlsShown(null)).toBe(true);
  expect(createBlockedReason({ ...pushed, changed: [ch("a")] })).toBe("Commit your changes first");
  expect(createBlockedReason({ ...pushed, conflicts: [ch("c", "X")] })).toBe("Resolve the conflicts first");
  expect(createBlockedReason(pushed)).toBeNull();
  expect(createBlockedReason(null)).toBe("Loading");
});
