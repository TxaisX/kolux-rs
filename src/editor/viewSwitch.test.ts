import { expect, test } from "vitest";
import { changesBanner, viewEditable, viewsFor } from "./viewSwitch";

test("EDIT-056 (T-237-b): code offers Edit and Changes, markdown Source, Rich and Changes, tables and diagrams a rendered view", () => {
  expect(viewsFor({ path: "C:/w/a.ts" }).views).toEqual(["edit", "changes"]);
  expect(viewsFor({ path: "C:/w/a.md" }).views).toEqual(["source", "rich", "changes"]);
  expect(viewsFor({ path: "C:/w/d.csv" }).views).toEqual(["source", "rendered", "changes"]);
  expect(viewsFor({ path: "C:/w/flow.MMD" }).views).toEqual(["source", "rendered", "changes"]);
  expect(viewsFor({ path: "C:/w/a.ts" }).why?.changes).toMatch(/last commit/);
});

test("EDIT-056 (T-237-b): no Changes for notebooks, untitled, outside the worktree, binary files, and diff or conflict tabs", () => {
  expect(viewsFor({ path: "C:/w/n.ipynb" }).views).toEqual(["source", "rendered"]);
  expect(viewsFor({ path: "C:/w/untitled.md", untitled: true }).views).toEqual(["source", "rich"]);
  expect(viewsFor({ path: "D:/x/a.ts", inWorktree: false }).views).toEqual(["edit"]);
  expect(viewsFor({ path: "C:/w/a.bin", binary: true }).views).toEqual(["edit"]);
  expect(viewsFor({ path: "C:/w/a.ts", kind: "diff" }).views).toEqual([]);
  expect(viewsFor({ path: "C:/w/a.ts", kind: "conflict" }).views).toEqual([]);
});

test("EDIT-056 (T-237-b): an unchanged file says so instead of showing an empty diff; the rendered table is read-only", () => {
  expect(changesBanner("same", "same")).toMatch(/Nothing uncommitted/);
  expect(changesBanner("old", "new")).toBeNull();
  expect(changesBanner(null, "new")).toBeNull(); // a file not in the last commit is all new, not unchanged
  expect(viewEditable("a.csv", "rendered")).toBe(false);
  expect(viewEditable("a.csv", "source")).toBe(true);
  expect(viewEditable("a.mmd", "rendered")).toBe(true);
});

import { drawn, headSides, underRoot, VIEW_LABEL } from "./viewSwitch";

test("EDIT-056 (T-237-b): Changes sets the last commit beside the working file, staged edits included", () => {
  expect(headSides({ original: "head" }, { modified: "work" })).toEqual({ original: "head", modified: "work" });
});

test("EDIT-056 (T-237-b): a file outside the worktree has no Changes; the switch draws only what can be shown", () => {
  expect(underRoot("C:\\w\\p\\a.ts", "C:/w/p")).toBe(true);
  expect(underRoot("C:/w/pp/a.ts", "C:/w/p")).toBe(false);
  expect(underRoot("C:/w/p/a.ts", null)).toBe(false);
  expect(drawn(viewsFor({ path: "a.ts" }), false)).toEqual(["edit", "changes"]);
  expect(drawn(viewsFor({ path: "a.md" }), false)).toEqual(["source", "rich", "changes"]);
  expect(drawn(viewsFor({ path: "a.csv" }), true)).toEqual(["source", "rendered", "changes"]);
  expect(drawn(viewsFor({ path: "a.mmd" }), false)).toEqual(["source", "changes"]);
  expect(drawn(viewsFor({ path: "a.ipynb" }), false)).toEqual(["source"]);
  expect(VIEW_LABEL.changes).toBe("Changes");
});
