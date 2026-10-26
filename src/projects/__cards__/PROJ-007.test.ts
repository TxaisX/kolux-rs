// PROJ-007 box 1: a repository with three worktrees whose main checkout is not first alphabetically
// opens on its main checkout.
import { expect, test } from "vitest";
import { openedWorktree, orderWorktrees, type Worktree } from "../model";

// Git's list order is not the main checkout first; the main sorts last by path and by branch.
const alpha: Worktree = { path: "C:/ws/app/alpha", branch: "alpha", head: "a1", isMain: false };
const beta: Worktree = { path: "C:/ws/app/beta", branch: "beta", head: "b1", isMain: false };
const main: Worktree = { path: "C:/zz/app-main", branch: "trunk", head: "c1", isMain: true };

test("the main checkout becomes the active workspace even though a worktree sorts before it", () => {
  const listed = [alpha, beta, main];
  expect(listed[0].isMain).toBe(false);
  expect([...listed].sort((a, b) => a.path.localeCompare(b.path))[0].isMain).toBe(false);
  // the project's folder is its main checkout
  expect(openedWorktree(listed, "C:/zz/app-main")?.path).toBe(main.path);
  expect(openedWorktree(listed, "C:\\ZZ\\app-main\\")?.isMain).toBe(true);
  // whatever order Git lists them in, and even when the folder spelling is not found, never "the first one"
  expect(openedWorktree([main, beta, alpha], "C:/zz/app-main")?.path).toBe(main.path);
  expect(openedWorktree([beta, alpha, main], "D:/no/such/spelling")?.path).toBe(main.path);
  expect(openedWorktree([alpha, beta, main], "D:/no/such/spelling")?.path).not.toBe(alpha.path);
  // the sidebar lists the main checkout first as well
  expect(orderWorktrees(listed).map((w) => w.path)).toEqual([main.path, alpha.path, beta.path]);
});
