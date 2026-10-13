// GIT-004: when the panel may commit, and which keystroke is the commit shortcut.
import { expect, test } from "vitest";
import { budgetLine, budgetLow, mergeActions, mergeLabel, type MergeInfo, graph, clashWord, abortLabel, capped, CONFLICT_CAP, filesWord, graphLines, explainPrompt, type Commit, linkedPrs, withLink, prMismatch, scmGroups, SCM_GROUP_ORDERS, prRefreshDelay, prLooked, PR_STALE_MS, prStateWord, prReason, withPr, type PrLook, commitItems, failureTitle, pushBadge, canCommit, conflictPrompt, emptyStatus, savedFixAgent, grouped, handedLine, sinceText, isCommitShortcut, nextStep, remoteItems, summaryLabel, summaryRows, summaryTotal, type Status, type Summary } from "./model";

const commit = (hash: string, parents: string[], subject = hash): Commit => ({ hash, short: hash, parents, author: "a", time: 0, subject, message: subject, labels: [], outgoing: false, incoming: false });

test("GIT-035: the lane graph keeps a straight line straight and joins a merged branch back", () => {
  const line = graph([commit("c", ["b"]), commit("b", ["a"]), commit("a", [])]);
  expect(line.map((r) => r.col)).toEqual([0, 0, 0]);
  expect(new Set(line.map((r) => r.color)).size).toBe(1);
  expect(line[2].lanesOut).toEqual([]);

  // m merges f into the line; f and b both sit on a, so the second lane ends there.
  const rows = graph([commit("m", ["b", "f"]), commit("f", ["a"]), commit("b", ["a"]), commit("a", [])]);
  expect(rows.map((r) => r.col)).toEqual([0, 1, 0, 0]);
  expect(rows[1].color).not.toBe(rows[0].color);
  expect(rows[3].lanesIn.length).toBe(2);
  expect(rows[3].lanesOut).toEqual([]);
  // The merge row draws one line down its own lane and one out to the new lane.
  const m = graphLines(rows[0]);
  expect(m).toContainEqual({ from: 0, to: 0, top: false, bottom: true, color: rows[0].color });
  expect(m).toContainEqual({ from: 0, to: 1, top: false, bottom: true, color: rows[1].color });
  // At a, the second lane bends in to the dot.
  expect(graphLines(rows[3])).toContainEqual({ from: 1, to: 0, top: true, bottom: false, color: rows[1].color });
});

test("GIT-036: Explain changes asks about that commit", () => {
  const p = explainPrompt(commit("0123456789abcdef", [], "feat: three"));
  expect(p).toContain("0123456789abcdef");
  expect(p).toContain("feat: three");
  expect(p).toContain("git show 0123456789abcdef");
});

test("GIT-066: the Source Control groups come in the chosen order, conflicts always first", () => {
  expect(scmGroups(undefined)).toEqual(["conflicts", "staged", "changes", "untracked"]);
  expect(scmGroups("changes-first")).toEqual(["conflicts", "changes", "untracked", "staged"]);
  expect(scmGroups("nonsense")).toEqual(scmGroups(undefined));
  for (const [id] of SCM_GROUP_ORDERS) expect([...scmGroups(id)].sort()).toEqual(["changes", "conflicts", "staged", "untracked"]);
});

test("GIT-027: the pull request refreshes itself, backs off after failures and keeps what it knew", () => {
  expect(prRefreshDelay(0)).toBe(PR_STALE_MS);
  expect(prRefreshDelay(1)).toBe(2 * PR_STALE_MS);
  expect(prRefreshDelay(2)).toBe(4 * PR_STALE_MS);
  expect(prRefreshDelay(50)).toBe(15 * 60_000);
  const pr = { number: 7, url: "https://github.com/o/r/pull/7", state: "OPEN", title: "t", head: "feat", draft: false };
  const known: PrLook = { loading: true, pr, error: null };
  // A failed refresh leaves the last pull request showing, with the reason.
  expect(prLooked(known, { error: "gh did not answer within 30 seconds" })).toEqual({ loading: false, pr, error: "gh did not answer within 30 seconds" });
  // An answer replaces it, a branch with none included.
  expect(prLooked(known, { pr: { ...pr, state: "MERGED" } })).toEqual({ loading: false, pr: { ...pr, state: "MERGED" }, error: null });
  expect(prLooked(known, { pr: null })).toEqual({ loading: false, pr: null, error: null });
});

test("GIT-025: a hand-linked pull request is kept per workspace and flagged when its branch differs", () => {
  expect(linkedPrs({ "G:/a": "https://github.com/o/r/pull/3", "G:/b": 4, bad: null })).toEqual({ "G:/a": "https://github.com/o/r/pull/3" });
  expect(linkedPrs("x")).toEqual({});
  expect(linkedPrs(["u"])).toEqual({});
  expect(withLink({ "G:/a": "u1" }, "G:/b", "u2")).toEqual({ "G:/a": "u1", "G:/b": "u2" });
  expect(withLink({ "G:/a": "u1", "G:/b": "u2" }, "G:/a", null)).toEqual({ "G:/b": "u2" });
  const pr = { number: 12, url: "https://github.com/o/r/pull/12", state: "MERGED", title: "Other", head: "other", draft: false };
  expect(prMismatch(pr, "feat")).toBe("Linked by hand to the pull request for other, not feat");
  expect(prMismatch({ ...pr, head: "feat" }, "feat")).toBe(null);
  expect(prMismatch({ ...pr, head: null }, "feat")).toBe(null);
  expect(prStateWord(pr)).toBe("Merged");
  expect(prStateWord({ ...pr, state: "OPEN", draft: true })).toBe("Draft");
  expect(prStateWord({ ...pr, state: "OPEN" })).toBe("Open");
  expect(prStateWord({ ...pr, state: "CLOSED" })).toBe("Closed");
});

test("GIT-023: create pull request says why it cannot run, and an open one is offered instead", () => {
  const ready: Status = { ...emptyStatus, branch: "feat", upstream: "origin/feat", base: "origin/main" };
  const none: PrLook = { loading: false, pr: null, error: null };
  expect(prReason(ready, none)).toBe(null);
  expect(prReason(null, none)).toBe("Loading");
  // GIT-023: a branch that tracks a fork remote is a fork head.
  expect(prReason({ ...ready, upstream: "fork/feat" }, none)).toBe("Fork head not supported: the branch tracks fork/feat; push it to origin first");
  expect(prReason({ ...ready, branch: "main", upstream: "origin/main" }, none)).toBe("Move to a feature branch first");
  expect(prReason({ ...ready, changed: [{ path: "a.txt", status: "M", from: null }] }, none)).toBe("Commit your changes first");
  expect(prReason({ ...ready, untracked: [{ path: "new.txt", status: "U", from: null }] }, none)).toBe(null);
  expect(prReason({ ...ready, upstream: null }, none)).toBe("Push the branch first");
  expect(prReason({ ...ready, ahead: 2 }, none)).toBe("Push 2 commits first");
  expect(prReason({ ...ready, ahead: 1, behind: 3 }, none)).toBe("Sync first: the remote has 3 commits this copy lacks");
  expect(prReason({ ...ready, base: null }, none)).toBe("No base branch on the remote");
  expect(prReason({ ...ready, branch: null }, none)).toBe("No branch checked out");
  expect(prReason(ready, { ...none, loading: true })).toBe("Checking for a pull request");
  expect(prReason(ready, { ...none, error: "Sign in to GitHub first: run gh auth login" })).toBe("Sign in to GitHub first: run gh auth login");
  expect(prReason(ready, { ...none, pr: { number: 4, url: "https://github.com/o/r/pull/4", state: "MERGED" } })).toBe("Pull request #4 already merged");
  const step = nextStep(ready, "");
  expect(withPr(step, ready, { ...none, loading: true })).toEqual({ label: "Create pull request", action: "pr", reason: "Checking for a pull request" });
  expect(withPr(step, ready, { ...none, pr: { number: 9, url: "https://github.com/o/r/pull/9", state: "OPEN" } })).toEqual({ label: "Open pull request #9", action: "pr", reason: null });
  expect(withPr(nextStep({ ...ready, ahead: 1 }, ""), ready, none).action).toBe("push");
});

test("GIT-005: commit-and items fit the branch and say why when they cannot run", () => {
  const ready: Status = { ...emptyStatus, branch: "fix", upstream: "origin/fix", base: "origin/main", staged: [{ path: "a.txt", status: "M", from: null }] };
  const ids = (s: Status | null, m = "fix it") => commitItems(s, m).map((i) => [i.id, i.reason]);
  expect(ids(ready)).toEqual([["push", null], ["sync", null], ["force", null], ["pullpush", null]]);
  expect(commitItems(ready, "x").find((i) => i.id === "force")?.title).toMatch(/lease/);
  expect(ids({ ...ready, behind: 2 })[0]).toEqual(["push", "The remote has 2 commits this copy lacks; use commit and sync"]);
  expect(new Set(ids({ ...ready, upstream: null }).map((r) => r[1]))).toEqual(new Set(["Branch unpublished; publish it first"]));
  expect(new Set(ids(ready, " ").map((r) => r[1]))).toEqual(new Set(["Write a commit message first"]));
  expect(new Set(ids({ ...ready, staged: [] }).map((r) => r[1]))).toEqual(new Set(["Nothing staged to commit"]));
});

test("GIT-009: push failure notices name the kind, and only a hook failure is offered to an agent", () => {
  expect(failureTitle("Push", { ok: false, output: "", kind: "protected", detail: null })).toBe("Push refused: the branch is protected on the remote");
  expect(failureTitle("Push", { ok: false, output: "", kind: "hook", detail: "lint" })).toBe("Push blocked by a hook (a lint or test check failed)");
  expect(failureTitle("Fetch", { ok: false, output: "", kind: "network", detail: null })).toBe("Fetch failed: the remote could not be reached");
  expect(failureTitle("Pull", { ok: false, output: "" })).toBe("Pull failed");
});

test("GIT-065: the sidebar badge says synced, unpushed, unpublished or cannot be checked", () => {
  expect(pushBadge({ path: "a", state: "synced", count: 0 })).toEqual({ text: "synced", tone: "good" });
  expect(pushBadge({ path: "a", state: "ahead", count: 2 })?.text).toBe("2 unpushed");
  expect(pushBadge({ path: "a", state: "unpublished", count: 1 })).toMatchObject({ text: "unpublished \u00b7 1", tone: "warn" });
  expect(pushBadge({ path: "a", state: "unpublished", count: 0 })).toBeNull();
  expect(pushBadge({ path: "a", state: "unknown", count: 0 })).toMatchObject({ text: "cannot be checked", tone: "warn" });
  expect(pushBadge(undefined)).toBeNull();
});

const staged: Status = { ...emptyStatus, staged: [{ path: "a.txt", status: "M", from: null }] };

test("commit needs staged work, a real message and no open conflict", () => {
  expect(canCommit(staged, "Fix it")).toBe(true);
  expect(canCommit(staged, "   \n")).toBe(false);
  expect(canCommit(emptyStatus, "Fix it")).toBe(false);
  expect(canCommit(null, "Fix it")).toBe(false);
  expect(canCommit({ ...staged, conflicts: [{ path: "b.txt", status: "X", from: null }] }, "Fix it")).toBe(false);
});

test("the shortcut is Ctrl+Enter or Cmd+Enter alone, never with Alt or Shift or mid-composition", () => {
  const key = (over: Partial<Parameters<typeof isCommitShortcut>[0]> = {}) => ({ key: "Enter", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, isComposing: false, ...over });
  expect(isCommitShortcut(key())).toBe(true);
  expect(isCommitShortcut(key({ ctrlKey: false, metaKey: true }))).toBe(true);
  expect(isCommitShortcut(key({ ctrlKey: false }))).toBe(false);
  expect(isCommitShortcut(key({ altKey: true }))).toBe(false);
  expect(isCommitShortcut(key({ shiftKey: true }))).toBe(false);
  expect(isCommitShortcut(key({ isComposing: true }))).toBe(false);
  expect(isCommitShortcut(key({ key: "a" }))).toBe(false);
});

test("the main button follows the branch through its states", () => {
  const pushed: Status = { ...emptyStatus, branch: "feat", upstream: "origin/feat", base: "origin/main" };
  const step = (s: Status | null, msg = "") => nextStep(s, msg).label;
  expect(nextStep(null, "x")).toMatchObject({ label: "Commit", reason: "Loading" });
  expect(step({ ...pushed, untracked: [{ path: "n.txt", status: "U", from: null }] })).toBe("Stage all");
  expect(nextStep({ ...pushed, staged: [{ path: "n.txt", status: "A", from: null }], changed: [{ path: "m.txt", status: "M", from: null }] }, "")).toMatchObject({ label: "Commit", reason: "Write a message first" });
  expect(nextStep({ ...pushed, staged: [{ path: "n.txt", status: "A", from: null }] }, "Add n")).toMatchObject({ label: "Commit", reason: null });
  expect(nextStep({ ...pushed, staged: [{ path: "n.txt", status: "A", from: null }], conflicts: [{ path: "c", status: "X", from: null }] }, "m").reason).toBe("Resolve the conflicts first");
  expect(nextStep({ ...pushed, branch: null, upstream: null }, "")).toMatchObject({ label: "Publish branch", reason: "HEAD is detached" });
  expect(nextStep({ ...pushed, upstream: null }, "")).toMatchObject({ label: "Publish branch", reason: null });
  expect(step({ ...pushed, ahead: 2 })).toBe("Push 2");
  expect(step({ ...pushed, behind: 1 })).toBe("Pull 1");
  expect(step({ ...pushed, ahead: 2, behind: 1 })).toBe("Sync \u21931 \u21912");
  expect(step({ ...pushed, ahead: 2, behind: 1, rewritten: true })).toBe("Force push with lease");
  expect(nextStep(pushed, "")).toMatchObject({ label: "Create pull request", action: "pr" });
});

test("the remote menu carries counts and gives every disabled item its reason", () => {
  const pushed: Status = { ...emptyStatus, branch: "feat", upstream: "origin/feat", base: "origin/main" };
  const by = (s: Status | null) => Object.fromEntries(remoteItems(s).map((i) => [i.id, i]));
  const current = by(pushed);
  expect(current.push).toMatchObject({ label: "Push", reason: "Nothing to push" });
  expect(current.sync.reason).toBe("Already current");
  expect(current.fetch.reason).toBeNull();
  expect(current.publish.reason).toBe("Already published");
  expect(current.rebase).toMatchObject({ label: "Rebase from origin/main", reason: null });
  const moved = by({ ...pushed, ahead: 2, behind: 1 });
  expect(moved.push).toMatchObject({ label: "Push 2 commits", reason: null });
  expect(moved.pull).toMatchObject({ label: "Pull 1 commit", reason: null });
  expect(moved.sync.label).toBe("Sync \u21931 \u21912");
  expect(moved.ff.reason).toBe("Local commits are in the way");
  expect(moved.force.reason).toBeNull();
  const fresh = by({ ...pushed, upstream: null });
  expect(fresh.push.reason).toBe("Branch unpublished");
  expect(fresh.publish.reason).toBeNull();
  expect(by({ ...pushed, branch: null }).publish.reason).toBe("No branch checked out");
  expect(by({ ...pushed, branch: "main", upstream: "origin/main" }).rebase.reason).toBe("This is the base branch");
  expect(by(null).push.reason).toBe("Loading");
});

const sum = (over: Partial<Summary> = {}): Summary => ({ against: "main", ahead: 1, behind: 0, source: { added: 10, removed: 0 }, tests: { added: 0, removed: 0 }, generated: { added: 0, removed: 0 }, files: 1, committed: [], ...over });

test("VIEW-068: the branch summary totals its rows, in full with grouped digits", () => {
  expect(summaryTotal(sum())).toEqual({ added: 10, removed: 0 });
  expect(grouped(8312)).toBe("8,312");
  expect(grouped(1234567)).toBe("1,234,567");
  const big = sum({ source: { added: 8312, removed: 40 }, tests: { added: 1200, removed: 3 }, generated: { added: 1500, removed: 0 } });
  expect(summaryTotal(big)).toEqual({ added: 11012, removed: 43 });
  expect(summaryRows(big)).toEqual([
    { label: "Source", added: 8312, removed: 40 },
    { label: "Tests", added: 1200, removed: 3 },
    { label: "Generated", added: 1500, removed: 0 },
  ]);
});

test("VIEW-068: without a test count the rest is non-generated, and an empty generated row is left out", () => {
  expect(summaryRows(sum())).toEqual([{ label: "Non-generated", added: 10, removed: 0 }]);
  expect(summaryRows(sum({ generated: { added: 3, removed: 1 } })).map((r) => r.label)).toEqual(["Non-generated", "Generated"]);
  expect(summaryRows(sum({ tests: { added: 2, removed: 0 } })).map((r) => r.label)).toEqual(["Source", "Tests"]);
});

test("VIEW-068: the screen-reader label carries the split", () => {
  const label = summaryLabel("feat", sum({ ahead: 2, behind: 1, tests: { added: 1200, removed: 3 } }));
  expect(label).toBe("feat, 2 ahead and 1 behind main, 1,210 lines added and 3 removed: source 10 added 0 removed, tests 1,200 added 3 removed");
});

test("EDIT-040: handing the note over adds a dated line naming who received it", () => {
  const at = new Date(2026, 9, 9, 14, 5);
  expect(handedLine("check login\n\n", "Claude Code", at)).toBe("check login\n\n— Handed to Claude Code on 2026-10-09 14:05");
  expect(handedLine("", "Codex", at)).toBe("— Handed to Codex on 2026-10-09 14:05");
});

test("EDIT-040: the note says how long since it last changed", () => {
  const now = Date.UTC(2026, 9, 9, 12, 0);
  expect(sinceText(now - 20_000, now)).toBe("Changed just now");
  expect(sinceText(now - 5 * 60_000, now)).toBe("Changed 5 min ago");
  expect(sinceText(now - 3 * 3_600_000, now)).toBe("Changed 3 h ago");
  expect(sinceText(now - 2 * 86_400_000, now)).toBe("Changed 2 d ago");
});

test("VIEW-069: the resolve-conflicts prompt names the files, and a saved agent is used only while it is installed", () => {
  const p = conflictPrompt([{ path: "a.txt", status: "U", from: null }, { path: "src/b.rs", status: "U", from: null }]);
  expect(p).toContain("a.txt");
  expect(p).toContain("src/b.rs");
  expect(p.toLowerCase()).toContain("conflict");
  const claude = { id: "claude", name: "Claude", program: "claude", args: [], installed: true, path: "c" };
  const codex = { id: "codex", name: "Codex", program: "codex", args: [], installed: false, path: null };
  expect(savedFixAgent([claude, codex], "claude")).toBe(claude);
  expect(savedFixAgent([claude, codex], "codex")).toBe(null);
  expect(savedFixAgent([claude, codex], undefined)).toBe(null);
  expect(savedFixAgent([claude, codex], 7)).toBe(null);
});

test("GIT-015: conflict cards name the clash and the abort matches the operation", () => {
  expect(clashWord("UU")).toBe("changed on both sides");
  expect(clashWord("AA")).toBe("added on both sides");
  expect(clashWord("DU")).toBe("deleted on one side");
  expect(clashWord("UD")).toBe("deleted on one side");
  expect(clashWord("AU")).toBe("added on one side");
  expect(clashWord("DD")).toBe("deleted on both sides");
  expect(abortLabel("merge")).toBe("Abort merge");
  expect(abortLabel("rebase")).toBe("Abort rebase");
  expect(abortLabel("cherry-pick")).toBe("Abort cherry-pick");
  expect(abortLabel(null)).toBeNull();
  const many = Array.from({ length: 130 }, (_, i) => ({ path: `f${i}`, status: "UU", from: null }));
  expect(capped(many, CONFLICT_CAP).shown).toHaveLength(100);
  expect(capped(many, CONFLICT_CAP).more).toBe(30);
  expect(capped(many.slice(0, 3), CONFLICT_CAP)).toEqual({ shown: many.slice(0, 3), more: 0 });
});

test("GIT-011: the branch row reads the files changed against its base", () => {
  expect(filesWord(1)).toBe("1 file changed");
  expect(filesWord(5)).toBe("5 files changed");
});

test("GIT-033: the merge label names what holds the pull request back and only possible actions are offered", () => {
  const m: MergeInfo = { state: "OPEN", draft: false, mergeable: "MERGEABLE", mergeState: "CLEAN", review: null, checks: "SUCCESS", inQueue: false, queueEnabled: false, autoMerge: null, methods: ["merge", "squash", "rebase"], autoAllowed: true };
  const acts = (x: MergeInfo) => mergeActions(x).map((a) => `${a.action}:${a.method ?? ""}`);
  expect(mergeLabel(m)).toBe("Ready to merge");
  expect(acts(m)).toEqual(["merge:merge", "merge:squash", "merge:rebase", "close:"]);
  expect(mergeActions(m)[1].label).toBe("Squash and merge");
  // A repository that allows squash only offers squash only.
  expect(acts({ ...m, methods: ["squash"] })).toEqual(["merge:squash", "close:"]);
  // Pending checks: merge when ready, and the label says so once auto-merge is on.
  const pending = { ...m, mergeState: "BLOCKED", checks: "PENDING" };
  expect(mergeLabel(pending)).toBe("Checks pending");
  expect(acts({ ...pending, methods: ["squash"] })).toEqual(["auto:squash", "close:"]);
  expect(mergeActions({ ...pending, methods: ["squash"] })[0].label).toBe("Squash and merge when ready");
  const on = { ...pending, autoMerge: "squash" };
  expect(mergeLabel(on)).toBe("Auto-merge on (squash) · Checks pending");
  expect(acts(on)).toEqual(["disable-auto:", "close:"]);
  // No auto-merge where the repository does not allow it, or on unstable, conflicting or draft ones.
  expect(acts({ ...pending, autoAllowed: false })).toEqual(["close:"]);
  expect(mergeLabel({ ...pending, checks: "FAILURE", mergeState: "UNSTABLE" })).toBe("Checks failed");
  expect(acts({ ...pending, checks: "FAILURE", mergeState: "UNSTABLE" })).toEqual(["close:"]);
  expect(mergeLabel({ ...m, mergeable: "CONFLICTING", mergeState: "DIRTY" })).toBe("Conflicts");
  expect(acts({ ...m, mergeable: "CONFLICTING", mergeState: "DIRTY" })).toEqual(["close:"]);
  expect(mergeLabel({ ...m, draft: true, mergeState: "DRAFT" })).toBe("Draft");
  expect(acts({ ...m, draft: true, mergeState: "DRAFT" })).toEqual(["ready:", "close:"]);
  // The other holds.
  expect(mergeLabel({ ...m, mergeState: "BLOCKED", review: "CHANGES_REQUESTED" })).toBe("Changes requested");
  expect(mergeLabel({ ...m, mergeState: "BLOCKED", review: "REVIEW_REQUIRED" })).toBe("Approval required");
  expect(mergeLabel({ ...m, mergeState: "BEHIND" })).toBe("Behind the base branch");
  expect(mergeLabel({ ...m, mergeState: "BLOCKED" })).toBe("Blocked");
  expect(mergeLabel({ ...m, mergeable: "UNKNOWN", mergeState: "UNKNOWN" })).toBe("Checking");
  // Merge queue.
  expect(acts({ ...m, queueEnabled: true })).toEqual(["queue:", "close:"]);
  expect(mergeLabel({ ...m, queueEnabled: true, inQueue: true })).toBe("In merge queue");
  expect(acts({ ...m, queueEnabled: true, inQueue: true })).toEqual(["close:"]);
  // Closed and merged.
  expect(mergeLabel({ ...m, state: "CLOSED" })).toBe("Closed");
  expect(acts({ ...m, state: "CLOSED" })).toEqual(["reopen:"]);
  expect(mergeLabel({ ...m, state: "MERGED" })).toBe("Merged");
  expect(acts({ ...m, state: "MERGED" })).toEqual([]);
});

test("GIT-028: each GitHub budget reads what is left and when it resets", () => {
  const now = 1760000000;
  expect(budgetLine({ name: "REST", limit: 5000, remaining: 4980, reset: now + 42 * 60 }, now)).toBe("REST: 4,980 of 5,000 left, resets in 42 min");
  expect(budgetLine({ name: "Search", limit: 30, remaining: 0, reset: now + 20 }, now)).toBe("Search: used up, resets in 1 min");
  expect(budgetLine({ name: "GraphQL", limit: 5000, remaining: 5000, reset: now - 5 }, now)).toBe("GraphQL: 5,000 of 5,000 left, resets in 1 min");
  expect(budgetLow({ name: "REST", limit: 5000, remaining: 499, reset: now })).toBe(true);
  expect(budgetLow({ name: "REST", limit: 5000, remaining: 500, reset: now })).toBe(false);
  expect(budgetLow({ name: "Search", limit: 30, remaining: 0, reset: now })).toBe(true);
});
