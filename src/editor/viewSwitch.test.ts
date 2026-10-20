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
