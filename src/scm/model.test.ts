// GIT-004: when the panel may commit, and which keystroke is the commit shortcut.
import { expect, test } from "vitest";
import { canCommit, emptyStatus, isCommitShortcut, type Status } from "./model";

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
