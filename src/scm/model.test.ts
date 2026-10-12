// GIT-004: when the panel may commit, and which keystroke is the commit shortcut.
import { expect, test } from "vitest";
import { canCommit, conflictPrompt, emptyStatus, savedFixAgent, grouped, handedLine, sinceText, isCommitShortcut, nextStep, remoteItems, summaryLabel, summaryRows, summaryTotal, type Status, type Summary } from "./model";

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

const sum = (over: Partial<Summary> = {}): Summary => ({ against: "main", ahead: 1, behind: 0, source: { added: 10, removed: 0 }, tests: { added: 0, removed: 0 }, generated: { added: 0, removed: 0 }, ...over });

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
