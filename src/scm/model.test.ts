// GIT-004: when the panel may commit, and which keystroke is the commit shortcut.
import { describe, expect, it, test } from "vitest";
import { cutBanner, changeCount as countOf } from "./model";
import { LINES_SKIPPED_NOTE, canCommit, conflictPrompt, emptyStatus, savedFixAgent, grouped, handedLine, sinceText, isCommitShortcut, nextStep, pushTarget, remoteItems, summaryLabel, summaryRows, summaryTotal, type Status, type Summary, bulk, rowOrder, rowKeys, selectRows, spanRuns, select, discardAsk, type Section, budgetLine, budgetLow, mergeActions, mergeLabel, type MergeInfo, graph, clashWord, abortLabel, capped, CONFLICT_CAP, filesWord, graphLines, commitUrl, explainPrompt, type Commit, linkedPrs, withLink, prMismatch, scmGroups, SCM_GROUP_ORDERS, prRefreshDelay, prLooked, PR_STALE_MS, prStateWord, prReason, withPr, type PrLook, commitItems, failureTitle, pushBadge, discardPlan, fileTree, reviewPrompt, SECTION_CAP, tooManyLine } from "./model";

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

test("GIT-036: a commit opens at its GitHub page, and only when the project is on GitHub", () => {
  expect(commitUrl({ host: "github.com", owner: "o", name: "r" }, "0123abc")).toBe("https://github.com/o/r/commit/0123abc");
  expect(commitUrl(null, "0123abc")).toBeNull();
});

test("GIT-066: the Source Control groups come in the chosen order, conflicts always first", () => {
  // VIEW-062: Changes, Staged, Untracked by default; staged-first and untracked-first on offer.
  expect(scmGroups(undefined)).toEqual(["conflicts", "changes", "staged", "untracked"]);
  expect(scmGroups("changes-first")).toEqual(scmGroups(undefined));
  expect(scmGroups("staged-first")).toEqual(["conflicts", "staged", "changes", "untracked"]);
  expect(scmGroups("untracked-first")).toEqual(["conflicts", "untracked", "changes", "staged"]);
  expect(SCM_GROUP_ORDERS.map(([id]) => id)).toEqual(["changes-first", "staged-first", "untracked-first"]);
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
  // A remote named "origin/fork" is not origin, though its upstream text starts with "origin/".
  expect(prReason({ ...ready, upstream: "origin/fork/feat", upstreamRemote: "origin/fork" }, none)).toBe("Fork head not supported: the branch tracks origin/fork/feat; push it to origin first");
  expect(prReason({ ...ready, upstream: "origin/feat", upstreamRemote: "origin" }, none)).toBeNull();
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

test("VIEW-066: a push to a fork names the fork remote, whatever form its address takes; origin stays unnamed", () => {
  expect(pushTarget("fork/feat", "fork")).toBe("fork");
  expect(pushTarget("origin/feat", "origin")).toBeNull();
  expect(pushTarget(null, null)).toBeNull();
  // A payload without the remote (an older back end) falls back to the upstream's first segment.
  expect(pushTarget("fork/feat")).toBe("fork");
  // A remote whose name holds a slash is named whole, and a local upstream (remote ".") names none.
  expect(pushTarget("team/fork/feat", "team/fork")).toBe("team/fork");
  expect(pushTarget("main", null)).toBeNull();
  const slashed: Status = { ...emptyStatus, branch: "feat", upstream: "team/fork/feat", upstreamRemote: "team/fork", ahead: 2, base: "origin/main" };
  expect(nextStep(slashed, "").label).toBe("Push 2 to team/fork");
  expect(remoteItems(slashed).find((i) => i.id === "push")?.label).toBe("Push 2 commits to team/fork");
  const onFork: Status = { ...emptyStatus, branch: "feat", upstream: "fork/feat", ahead: 2, base: "origin/main" };
  expect(nextStep(onFork, "").label).toBe("Push 2 to fork");
  expect(remoteItems(onFork).find((i) => i.id === "push")?.label).toBe("Push 2 commits to fork");
  expect(nextStep({ ...onFork, upstream: "origin/feat" }, "").label).toBe("Push 2");
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

const row = (path: string) => ({ path, status: "M", from: null });

test("GIT-002: a click selects one row, Ctrl toggles, Shift spans from the anchor in list order; rows that are gone drop out", () => {
  const order = ["a", "b", "c", "d"];
  expect(select([], order, "b", "one", null)).toEqual(["b"]);
  expect(select(["b"], order, "b", "one", "b")).toEqual([]);
  expect(select(["b"], order, "c", "one", "b")).toEqual(["c"]);
  expect(select(["b"], order, "d", "toggle", "b")).toEqual(["b", "d"]);
  expect(select(["b", "d"], order, "b", "toggle", "d")).toEqual(["d"]);
  expect(select(["b"], order, "d", "span", "b")).toEqual(["b", "c", "d"]);
  expect(select(["c"], order, "a", "span", "c")).toEqual(["a", "b", "c"]);
  expect(select([], order, "c", "span", null)).toEqual(["c"]);
  expect(select(["zz"], order, "a", "toggle", null)).toEqual(["a"]);
});

test("GIT-002: the bulk bar counts the selected rows each action covers, in display order, ignoring rows that are gone", () => {
  const s: Status = { ...emptyStatus, staged: [row("s1"), row("s2")], changed: [row("c1")], untracked: [row("u1")], conflicts: [row("x1")] };
  expect(rowOrder(s, "staged-first")).toEqual(["x1", "s1", "s2", "c1", "u1"]);
  const b = bulk(s, ["s1", "c1", "u1", "x1", "gone"], "staged-first");
  expect(b.present).toEqual(["x1", "s1", "c1", "u1"]);
  expect(bulk(s, ["s1", "c1", "u1", "x1", "gone"]).present).toEqual(["x1", "c1", "s1", "u1"]);
  expect(b.stage).toEqual(["x1", "c1", "u1"]);
  expect(b.unstage).toEqual(["s1"]);
  expect(bulk(s, []).present).toEqual([]);
});

// FIX-BEFORE-2: Shift-click spans the rows the panel draws, in the order it draws them: the saved
// group order (Changes first by default), the filter, the per-section cap and closed tree folders.
test("FIX-BEFORE-2: a span follows the drawn order across a reordered, capped, filtered or folded section", () => {
  const s: Status = { ...emptyStatus, staged: [row("s1"), row("s2")], changed: [row("c1"), row("c2")], untracked: [row("u1")], conflicts: [row("x1")] };
  // Default order: conflicts, Changes, Staged, Untracked; every saved order is followed.
  expect(rowOrder(s)).toEqual(["x1", "c1", "c2", "s1", "s2", "u1"]);
  expect(rowOrder(s, "untracked-first")).toEqual(["x1", "u1", "c1", "c2", "s1", "s2"]);
  expect(rowOrder(s, "no-such-order")).toEqual(rowOrder(s));
  // Click a Changes row, Shift-click the Staged row below it: just the rows between, as drawn.
  expect(select(["c2"], rowOrder(s, undefined, {}), "s1", "span", "c2")).toEqual(["c2", "s1"]);
  // A capped section: rows past the cap are not drawn, so a span never takes them in.
  const many = Array.from({ length: SECTION_CAP + 2 }, (_, i) => row(`c${String(i).padStart(3, "0")}`));
  const big: Status = { ...emptyStatus, changed: many, staged: [row("s1")] };
  const last = many[SECTION_CAP - 1].path;
  const drawn = rowOrder(big, undefined, {});
  expect(drawn).toHaveLength(SECTION_CAP + 1);
  expect(drawn).not.toContain(many[SECTION_CAP].path);
  expect(select([last], drawn, "s1", "span", last)).toEqual([last, "s1"]);
  // Without a drawn view (the review prompt) every row still counts.
  expect(rowOrder(big)).toHaveLength(SECTION_CAP + 3);
  // A filter hides rows from the span.
  expect(select(["c1"], rowOrder(s, undefined, { filter: "s2" }), "s2", "span", "c1")).toEqual(["s2"]);
  expect(rowOrder(s, undefined, { filter: "c" })).toEqual(["x1", "c1", "c2"]);
  // Tree view: a closed folder's files are not drawn; rows run folders first, then by name.
  const t: Status = { ...emptyStatus, changed: [row("z.txt"), row("a/x.ts"), row("a/y.ts")], staged: [row("b/q.ts")] };
  expect(rowOrder(t, undefined, { tree: new Set() })).toEqual(["a/x.ts", "a/y.ts", "z.txt", "b/q.ts"]);
  expect(rowOrder(t, undefined, { tree: new Set(["Changes/a"]) })).toEqual(["z.txt", "b/q.ts"]);
  expect(select(["z.txt"], rowOrder(t, undefined, { tree: new Set(["Changes/a"]) }), "b/q.ts", "span", "z.txt")).toEqual(["z.txt", "b/q.ts"]);
  // A folder closed in one section stays open in another.
  expect(rowOrder({ ...t, staged: [row("a/w.ts")] }, undefined, { tree: new Set(["Changes/a"]) })).toEqual(["z.txt", "a/w.ts"]);
});

// VIEW-067: the prompt says what discarding does to each kind of row, in the right number.
test("discarding one row names what happens to it", () => {
  const one = (section: Section, status: string, from: string | null = null) => discardAsk(section, [{ path: "a.txt", status, from }], false);
  expect(one("Untracked", "?")).toMatchObject({ title: "Delete a.txt?", confirm: "Delete", paths: ["a.txt"] });
  expect(one("Untracked", "?").body).toContain("untracked");
  expect(one("Staged", "A").body).toContain("staged new file");
  expect(one("Staged", "A").confirm).toBe("Delete");
  expect(one("Changes", "D")).toMatchObject({ title: "Restore a.txt?", confirm: "Restore" });
  expect(one("Changes", "M")).toMatchObject({ title: "Discard changes to a.txt?", confirm: "Discard" });
  // A staged rename puts the old name back too.
  expect(one("Staged", "R", "old.txt").paths).toEqual(["old.txt", "a.txt"]);
});

test("discard all counts each kind in singular or plural and warns about staged new files", () => {
  const rows = [
    { path: "n1", status: "A", from: null },
    { path: "n2", status: "A", from: null },
    { path: "d", status: "D", from: null },
    { path: "m", status: "M", from: null },
  ];
  const ask = discardAsk("Staged", rows, true);
  expect(ask.title).toBe("Discard all 4 in Staged?");
  expect(ask.confirm).toBe("Discard all");
  expect(ask.body).toContain("2 files are deleted");
  expect(ask.body).toContain("1 deleted file is restored");
  expect(ask.body).toContain("1 file loses its changes");
  expect(ask.body).toContain("Staged new files are deleted");
  const plain = discardAsk("Changes", [rows[3], { path: "m2", status: "M", from: null }], true);
  expect(plain.body).toContain("2 files lose their changes");
  expect(plain.body).not.toContain("Staged new");
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

test("GIT-003: the discard question is worded per case and names the button, every version warning there is no undo", () => {
  const c = (path: string, status: string, from: string | null = null) => ({ path, status, from });
  expect(discardPlan([c("notes.txt", "U")])).toEqual({ title: "Delete notes.txt?", body: "This file is in no commit, so it is removed for good. There is no undo.", button: "Delete" });
  expect(discardPlan([c("added.txt", "A")]).button).toBe("Delete");
  expect(discardPlan([c("gone.txt", "D")])).toEqual({ title: "Restore gone.txt?", body: "The file comes back as it was in the last commit. There is no undo.", button: "Restore" });
  expect(discardPlan([c("src/a.ts", "M")])).toEqual({ title: "Discard changes to src/a.ts?", body: "Its edits since the last commit are lost. There is no undo.", button: "Discard" });
  // A whole section of untracked files says how many go.
  const forty = Array.from({ length: 40 }, (_, i) => c(`u${i}.txt`, "U"));
  expect(discardPlan(forty)).toEqual({ title: "Delete 40 new files?", body: "40 new files are removed for good. There is no undo.", button: "Delete" });
  // Mixed rows: each kind is counted, and the button is the general Discard.
  const mixed = discardPlan([c("a.txt", "U"), c("b.txt", "D"), c("c.txt", "M"), c("d.txt", "R", "old.txt"), c("e.txt", "D")]);
  expect(mixed).toEqual({ title: "Discard 5 changes?", body: "1 new file is removed for good, 2 deleted files come back from the last commit, 2 files lose their edits. There is no undo.", button: "Discard" });
  expect(discardPlan([c("a.txt", "D"), c("b.txt", "D")]).button).toBe("Restore");
});

test("GIT-001: the tree view puts folders first, each folder row knows every file beneath it, and a closed folder hides them", () => {
  const rows = ["src/a.ts", "src/lib/b.ts", "README.md", "src/lib/c d.ts"].map((path) => ({ path, status: "M", from: null }));
  const open = fileTree(rows, new Set());
  expect(open.map((i) => `${i.depth}:${i.kind}:${i.name}`)).toEqual(["0:dir:src", "1:dir:lib", "2:file:b.ts", "2:file:c d.ts", "1:file:a.ts", "0:file:README.md"]);
  expect(open[0].kind === "dir" && open[0].files).toEqual(["src/a.ts", "src/lib/b.ts", "src/lib/c d.ts"]);
  const shut = fileTree(rows, new Set(["src/lib"]));
  expect(shut.map((i) => i.name)).toEqual(["src", "lib", "a.ts", "README.md"]);
  expect(shut[1].kind === "dir" && shut[1].files).toEqual(["src/lib/b.ts", "src/lib/c d.ts"]);
});

test("GIT-016: the review prompt names the base and stops each file list at 50; a branch with nothing to look at gets no prompt", () => {
  const files = Array.from({ length: 60 }, (_, i) => ({ path: `src/f${i + 1}.ts`, status: "M", from: null }));
  const p = reviewPrompt("origin/main", files, 60, ["notes.md"]);
  expect(p).toContain("origin/main");
  expect(p).toContain("- src/f50.ts");
  expect(p).not.toContain("- src/f51.ts");
  expect(p).toContain("and 10 more");
  expect(p).toContain("- notes.md");
  expect(reviewPrompt("main", files.slice(0, 2), 1200, [])).toContain("and 1198 more");
  expect(reviewPrompt("main", [], 0, [])).toBeNull();
});

describe("T-313 (GIT-008 / GIT-014)", () => {
  it("GIT-008: a pull with no policy is named, and each policy reruns the pull or copies its git config command", async () => {
    const m = await import("./model");
    expect(m.failureTitle("Pull", { ok: false, output: "", kind: "no-policy" })).toContain("no pull policy");
    expect(m.PULL_POLICIES.map((p) => [p.action, p.config])).toEqual([
      ["pullmerge", "git config pull.rebase false"],
      ["pullrebase", "git config pull.rebase true"],
      ["ff", "git config pull.ff only"],
    ]);
  });
  it("GIT-014: the filter keeps rows whose path or old path holds the text, any case; empty keeps all", async () => {
    const { filterRows } = await import("./model");
    const rows = [{ path: "src/App.tsx", status: "M" }, { path: "docs/readme.md", status: "R", from: "README.md" }, { path: "lib/util.ts", status: "U" }];
    expect(filterRows(rows, "app").map((r) => r.path)).toEqual(["src/App.tsx"]);
    expect(filterRows(rows, "README").map((r) => r.path)).toEqual(["docs/readme.md"]);
    expect(filterRows(rows, "  ")).toHaveLength(3);
    expect(filterRows(rows, "nothing")).toEqual([]);
  });
  it("GIT-014: the full path joins the worktree and the repository-relative path in the worktree's slash style", async () => {
    const { fullPath } = await import("./model");
    expect(fullPath("C:\\work\\repo", "src/a.ts")).toBe("C:\\work\\repo\\src\\a.ts");
    expect(fullPath("C:\\work\\repo\\", "a.ts")).toBe("C:\\work\\repo\\a.ts");
    expect(fullPath("/home/u/repo", "src/a.ts")).toBe("/home/u/repo/src/a.ts");
  });
});

test("VIEW-062: the tree folds a chain of single-child folders into one row, never a folder with more than one child", () => {
  const rows = ["a/b/c/x.ts", "a/b/c/y.ts", "d/e.ts", "d/f/g.ts"].map((path) => ({ path, status: "M", from: null }));
  const open = fileTree(rows, new Set());
  expect(open.map((i) => `${i.depth}:${i.kind}:${i.name}`)).toEqual(["0:dir:a/b/c", "1:file:x.ts", "1:file:y.ts", "0:dir:d", "1:dir:f", "2:file:g.ts", "1:file:e.ts"]);
  expect(open[0].kind === "dir" && open[0].path).toBe("a/b/c");
  // A folded row closes as one: its key is the deepest folder's path.
  expect(fileTree(rows, new Set(["a/b/c"])).map((i) => i.name)).toEqual(["a/b/c", "d", "f", "g.ts", "e.ts"]);
  // A folder holding a folder and a file keeps its own row.
  const mixed = fileTree(["p/q/r.ts", "p/s.ts"].map((path) => ({ path, status: "M", from: null })), new Set());
  expect(mixed.map((i) => i.name)).toEqual(["p", "q", "r.ts", "s.ts"]);
});

test("VIEW-062: a very large change set lists the first rows and says plainly how many more there are", () => {
  expect(SECTION_CAP).toBeGreaterThanOrEqual(200);
  const rows = Array.from({ length: SECTION_CAP + 1234 }, (_, i) => ({ path: `f${i}.ts`, status: "M", from: null }));
  const { shown, more } = capped(rows, SECTION_CAP);
  expect(shown).toHaveLength(SECTION_CAP);
  expect(tooManyLine(more)).toBe("1,234 more files are not listed here, so the panel stays quick. Type part of a path in the filter, or open All Changes, to see them.");
  expect(tooManyLine(1)).toBe("1 more file is not listed here, so the panel stays quick. Type part of a path in the filter, or open All Changes, to see it.");
});

test("FIX-4: a Shift-click whose anchor row is no longer drawn is a plain click, never a span by path", () => {
  // d/p is partly staged: in Changes (a folder is listed first) and in Staged (before c). Staged/d is closed in the tree view,
  // so the Staged copy of d/p is not drawn; the anchor was clicked before the folder closed.
  const s: Status = { ...emptyStatus, changed: [row("a"), row("d/p"), row("b")], staged: [row("d/p"), row("c")] };
  const keys = rowKeys(s, undefined, { filter: "", tree: new Set(["Staged/d"]) });
  expect(keys.map((k) => k.section + ":" + k.path)).toEqual(["Changes:d/p", "Changes:a", "Changes:b", "Staged:c"]);
  const anchor = { section: "Staged" as const, path: "d/p" };
  // The path span would run from the Changes copy of d/p and take in a and b; a hidden anchor selects just the clicked row.
  expect(selectRows(["d/p"], keys, { section: "Staged", path: "c" }, "span", anchor)).toEqual(["c"]);
  // With the anchor still drawn the span is unchanged.
  expect(selectRows(["d/p"], keys, { section: "Staged", path: "c" }, "span", { section: "Changes", path: "d/p" })).toEqual(["d/p", "a", "b", "c"]);
  // The same when the section cap hides the anchor's row.
  const many = Array.from({ length: SECTION_CAP + 3 }, (_, i) => row("f" + i));
  const capped2: Status = { ...emptyStatus, changed: [row("z0"), row("f" + (SECTION_CAP + 1)), row("z1")], staged: many };
  const keys2 = rowKeys(capped2, undefined, { filter: "" });
  const hidden = { section: "Staged" as const, path: "f" + (SECTION_CAP + 1) };
  expect(keys2.some((k) => k.section === hidden.section && k.path === hidden.path)).toBe(false);
  expect(selectRows(["z0"], keys2, { section: "Staged", path: "f1" }, "span", hidden)).toEqual(["f1"]);
});

test("FIX-5: a Shift-click that falls back selects the clicked row (never clears it) and becomes the new anchor", () => {
  const s: Status = { ...emptyStatus, changed: [row("a"), row("d/p"), row("b")], staged: [row("d/p"), row("c")] };
  const keys = rowKeys(s, undefined, { filter: "", tree: new Set(["Staged/d"]) });
  const hidden = { section: "Staged" as const, path: "d/p" };
  const c = { section: "Staged" as const, path: "c" };
  // c is already the only selection: a plain click would clear it, a fallen-back Shift-click keeps it.
  expect(selectRows(["c"], keys, c, "span", hidden)).toEqual(["c"]);
  // No anchor at all (nothing clicked yet): Shift-click selects the row too.
  expect(selectRows(["c"], keys, c, "span", null)).toEqual(["c"]);
  // The panel moves the anchor to the clicked row exactly when the span could not run.
  expect(spanRuns(keys, c, hidden)).toBe(false);
  expect(spanRuns(keys, c, null)).toBe(false);
  expect(spanRuns(keys, hidden, c)).toBe(false);
  expect(spanRuns(keys, c, { section: "Changes", path: "a" })).toBe(true);
});

test("FIX-3: a file drawn in two sections is two rows, and a Shift span covers exactly the rows between the two clicks", () => {
  // p is partly staged: it sits in Changes (a folder is listed first) and in Staged (between nothing and c).
  const s: Status = { ...emptyStatus, changed: [row("a"), row("p"), row("b")], staged: [row("p"), row("c")] };
  const keys = rowKeys(s);
  expect(keys).toEqual([
    { section: "Changes", path: "a" },
    { section: "Changes", path: "p" },
    { section: "Changes", path: "b" },
    { section: "Staged", path: "p" },
    { section: "Staged", path: "c" },
  ]);
  expect(rowOrder(s)).toEqual(["a", "p", "b", "c"]);
  // Why paths alone are not enough: p's first position is its Changes row, so the same two clicks
  // on a path-only list wrongly take in b (the Changes row outside the clicks).
  expect(select(["c"], rowOrder(s), "p", "span", "c")).toEqual(["p", "b", "c"]);
  // Click c in Staged, Shift-click p in Staged (the row right above it): just p and c, never b.
  expect(selectRows(["c"], keys, { section: "Staged", path: "p" }, "span", { section: "Staged", path: "c" })).toEqual(["p", "c"]);
  // The same span the other way round, and from the Changes copy of p down to b.
  expect(selectRows(["p"], keys, { section: "Staged", path: "c" }, "span", { section: "Staged", path: "p" })).toEqual(["p", "c"]);
  expect(selectRows(["p"], keys, { section: "Changes", path: "b" }, "span", { section: "Changes", path: "p" })).toEqual(["p", "b"]);
  // Across the sections the span takes every row between the two clicks, each path once.
  expect(selectRows(["a"], keys, { section: "Staged", path: "c" }, "span", { section: "Changes", path: "a" })).toEqual(["a", "p", "b", "c"]);
  // Every other mode behaves as `select` does on paths; a span with no anchor is one row.
  expect(selectRows([], keys, { section: "Staged", path: "p" }, "one", null)).toEqual(["p"]);
  expect(selectRows(["a"], keys, { section: "Staged", path: "c" }, "toggle", null)).toEqual(["a", "c"]);
  expect(selectRows([], keys, { section: "Staged", path: "c" }, "span", null)).toEqual(["c"]);
  // The drawn view keys rows the same way: the tree view and the group order carry the sections along.
  expect(rowKeys(s, "staged-first").map((k) => k.section + ":" + k.path)).toEqual(["Staged:p", "Staged:c", "Changes:a", "Changes:p", "Changes:b"]);
  expect(rowKeys({ ...s, conflicts: [row("x")] }, undefined, {})[0]).toEqual({ section: "Conflicts", path: "x" });
});

test("GIT-011 an enormous branch says so instead of showing line totals", () => {
  const big = sum({ files: 30000, linesSkipped: true });
  expect(summaryLabel("feat", big)).toBe(`feat, 1 ahead and 0 behind main, ${LINES_SKIPPED_NOTE}`);
  expect(summaryLabel("feat", sum())).toContain("10 lines added");
});

test("T-281 (GIT-012): a cut list says how much is left out, offers its heavy folders and still counts every change", () => {
  expect(cutBanner(null)).toBeNull();
  expect(cutBanner({ cut: 0, heavy: [] })).toBeNull();
  expect(cutBanner({ cut: 1, heavy: [] })).toEqual({ text: "This list is cut short: 1 more change is left out so the panel stays quick.", offer: [] });
  const b = cutBanner({ cut: 12345, heavy: ["node_modules", "dist"] });
  expect(b?.text).toContain("12,345 more changes are left out");
  expect(b?.offer).toEqual(["node_modules", "dist"]);
  const s = { ...emptyStatus, changed: [{ path: "a", status: "M" }], cut: 4 } as unknown as Status;
  expect(countOf(s)).toBe(5);
});
