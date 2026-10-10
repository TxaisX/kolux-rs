import { expect, test } from "vitest";
import { folderName, openedWorktree, relPath, nestRows, orderWorktrees, placeFieldAction, previewSentence, worktreeLabel, type Worktree } from "./model";

const main: Worktree = { path: "C:\\src\\app", branch: "main", head: "aaaaaaa1", isMain: true };
const zeta: Worktree = { path: "C:\\ws\\app\\zeta", branch: "zeta", head: "bbbbbbb2", isMain: false };
const fix: Worktree = { path: "C:\\ws\\app\\fix-login", branch: "fix-login", head: "ccccccc3", isMain: false };
const loose: Worktree = { path: "C:\\ws\\app\\loose", branch: null, head: "ddddddd4ddd", isMain: false };

test("rows say the typed name, else the branch, else the short commit when detached", () => {
  expect(worktreeLabel({ ...fix, name: "Fix login \u{1F525}" })).toBe("Fix login \u{1F525}");
  expect(worktreeLabel(fix)).toBe("fix-login");
  expect(worktreeLabel(loose)).toBe("detached at ddddddd");
});

test("the main checkout is listed first, the rest by name, whatever order git gave", () => {
  expect(orderWorktrees([zeta, loose, fix, main]).map(worktreeLabel)).toEqual(["main", "detached at ddddddd", "fix-login", "zeta"]);
});

test("folder names come off either slash style", () => {
  expect(folderName("C:\\ws\\app\\fix-login")).toBe("fix-login");
  expect(folderName("/home/t/ws/app/")).toBe("app");
});

test("the preview sentence explains the branch and folder, or the refusal", () => {
  const project = { id: "app-1", name: "app", path: "C:\\src\\app" };
  expect(previewSentence("", null, project)).toMatch(/Type a name/);
  expect(previewSentence("???", null, project)).toMatch(/nothing usable/);
  expect(previewSentence("Fix login", { branch: "fix-login", folder: "C:\\ws\\app\\fix-login" }, project)).toBe("branch fix-login · folder C:\\ws\\app\\fix-login");
  expect(previewSentence("x", { branch: "x", folder: "" }, null)).toBe("Add a project first.");
});

// PROJ-047: child workspaces nest under their parent.
const p: Worktree = { path: "C:\ws\app\p", branch: "p", head: "e1", isMain: false };
const child: Worktree = { path: "C:\ws\app\child", branch: "child", head: "e2", isMain: false, parent: p.path };
const grand: Worktree = { path: "C:\ws\app\grand", branch: "grand", head: "e3", isMain: false, parent: child.path };
const orphan: Worktree = { path: "C:\ws\app\orphan", branch: "orphan", head: "e4", isMain: false, parent: "C:\ws\app\gone" };
const shape = (rows: ReturnType<typeof nestRows>) => rows.map((r) => `${"-".repeat(r.depth)}${worktreeLabel(r.w)}${r.kids ? "+" : ""}`);

test("a child sits under its parent, to any depth; a child whose parent is gone is top level", () => {
  expect(shape(nestRows([grand, zeta, orphan, child, p], true, new Set()))).toEqual(["orphan", "p+", "-child+", "--grand", "zeta"]);
  expect(shape(nestRows([{ ...fix, parent: main.path }], true, new Set()))).toEqual(["fix-login"]); // made from main: top level
});

test("folding a parent hides everything under it; nesting off is one flat level", () => {
  expect(shape(nestRows([grand, child, p, zeta], true, new Set([p.path])))).toEqual(["p+", "zeta"]);
  expect(shape(nestRows([grand, child, p, zeta], true, new Set([child.path])))).toEqual(["p+", "-child+", "zeta"]);
  expect(shape(nestRows([grand, child, p, zeta], false, new Set([p.path])))).toEqual(["child", "grand", "p", "zeta"]);
});

test("a loop of parents is listed flat rather than lost", () => {
  const a: Worktree = { ...p, parent: child.path };
  expect(shape(nestRows([a, child], true, new Set())).sort()).toEqual(["child", "p"]);
});

test("nesting keeps the order it is handed when the list is sorted elsewhere (PROJ-050)", () => {
  expect(shape(nestRows([zeta, child, p], true, new Set(), (ws) => ws))).toEqual(["zeta", "p+", "-child"]);
});

test("the workspaces-folder field saves on Enter, reverts on Escape and ignores keys mid-composition (SET-032)", () => {
  expect(placeFieldAction("Enter", false)).toBe("save");
  expect(placeFieldAction("Escape", false)).toBe("revert");
  expect(placeFieldAction("Enter", true)).toBeNull();
  expect(placeFieldAction("Escape", true)).toBeNull();
  expect(placeFieldAction("a", false)).toBeNull();
});

test("hidden worktrees are listed relative to the project folder", () => {
  expect(relPath("C:\\src\\app", "C:\\src\\app\\.worktrees\\x")).toBe(".worktrees/x");
  expect(relPath("C:\\src\\app", "C:\\ws\\app\\fix-login")).toBe("../../ws/app/fix-login");
  expect(relPath("c:/src/app/", "C:\\SRC\\app")).toBe(".");
  expect(relPath("C:\\src\\app", "D:\\other\\x")).toBe("D:\\other\\x");
});

// PROJ-006: a linked worktree added as its own project opens on that folder, not the main checkout.
test("the workspace opened after adding is the folder picked, else the main checkout", () => {
  expect(openedWorktree([main, zeta], "c:/ws/app/zeta/")?.path).toBe(zeta.path);
  expect(openedWorktree([zeta, main], "C:\src\app")?.path).toBe(main.path);
  expect(openedWorktree([zeta, main], "D:\elsewhere")?.path).toBe(main.path);
  expect(openedWorktree([], "C:\src\app")).toBeUndefined();
});
