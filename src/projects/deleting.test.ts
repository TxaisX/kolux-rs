import { expect, test } from "vitest";
import { asksBeforeDelete, blocker, deleteTarget, isClean, shownChanges, skipsQuestion, type RemoveCheck } from "./deleting";

const clean: RemoveCheck = { changes: [], locked: null, nested: [], stamp: "h|" };

test("the question is skipped only for a clean workspace with the setting off", () => {
  expect(asksBeforeDelete({})).toBe(true);
  expect(asksBeforeDelete({ confirmWorkspaceDelete: false })).toBe(false);
  expect(skipsQuestion(clean, {})).toBe(false);
  expect(skipsQuestion(clean, { confirmWorkspaceDelete: false })).toBe(true);
  expect(skipsQuestion({ ...clean, changes: ["?? a"] }, { confirmWorkspaceDelete: false })).toBe(false);
  expect(skipsQuestion({ ...clean, locked: "" }, { confirmWorkspaceDelete: false })).toBe(false);
});

test("a lock or a nested workspace blocks, changes only warn", () => {
  expect(blocker(clean)).toBeNull();
  expect(blocker({ ...clean, changes: ["?? a"] })).toBeNull();
  expect(isClean({ ...clean, changes: ["?? a"] })).toBe(false);
  expect(blocker({ ...clean, locked: "" })).toMatch(/locked\. Kolux never/);
  expect(blocker({ ...clean, locked: "usb" })).toMatch(/locked \(usb\)/);
  expect(blocker({ ...clean, nested: ["C:/w/a/b"], locked: "x" })).toMatch(/C:\/w\/a\/b/);
});

test("at most five changes are listed, with a count of the rest", () => {
  const many = { ...clean, changes: ["1", "2", "3", "4", "5", "6", "7"] };
  expect(shownChanges(many)).toEqual({ lines: ["1", "2", "3", "4", "5"], more: 2 });
  expect(shownChanges(clean)).toEqual({ lines: [], more: 0 });
});

test("VIEW-048: the shortcut deletes the hovered workspace before the active one", () => {
  expect(deleteTarget("G:/ws/b", "G:/ws/a")).toBe("G:/ws/b");
  expect(deleteTarget(null, "G:/ws/a")).toBe("G:/ws/a");
  expect(deleteTarget(null, null)).toBe(null);
});
