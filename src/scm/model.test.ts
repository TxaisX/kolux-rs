// GIT-004: when the panel may commit, and which keystroke is the commit shortcut.
import { expect, test } from "vitest";
import { canCommit, emptyStatus, isCommitShortcut, nextStep, remoteItems, type Status } from "./model";

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
