import { expect, test } from "vitest";
import { flatten, type Node } from "./Explorer";
import { DOTFILES_KEY, IGNORED_KEY, filterRows, folderGlob, hidesDotfiles, matchesName, rowMenu, sameNodes, withDotfiles, withoutDotfiles, withoutIgnored } from "./explorerView";

const R = "C:/w";
const d = (name: string, at: string): Node => ({ name, path: `${at}/${name}`, kind: "dir" });
const f = (name: string, at: string): Node => ({ name, path: `${at}/${name}`, kind: "file" });
const kids: Record<string, Node[]> = {
  [R]: [d("src", R), f(".env", R), f("README.md", R), d("docs", R)],
  [`${R}/src`]: [d("ui", `${R}/src`), f("main.ts", `${R}/src`), f("test.ts", `${R}/src`)],
  [`${R}/src/ui`]: [f("Test.tsx", `${R}/src/ui`), f("button.tsx", `${R}/src/ui`)],
  [`${R}/docs`]: [f("intro.md", `${R}/docs`)],
};
const all = new Set(Object.keys(kids));

test("EDIT-035 (T-236-b): typing test keeps the matching rows and the folders above them, in tree order", () => {
  const rows = filterRows(flatten(R, kids, all), "test");
  expect(rows.map((r) => r.node.path)).toEqual([`${R}/src`, `${R}/src/ui`, `${R}/src/ui/Test.tsx`, `${R}/src/test.ts`]);
  expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 1]);
});

test("EDIT-035 (T-236-b): an empty or blank filter keeps every row; a filter nothing fits leaves none", () => {
  const rows = flatten(R, kids, all);
  expect(filterRows(rows, "")).toBe(rows);
  expect(filterRows(rows, "   ")).toBe(rows);
  expect(filterRows(rows, "zzz")).toEqual([]);
  expect(matchesName("README.md", "readme")).toBe(true);
  expect(matchesName("README.md", "x")).toBe(false);
});

test("EDIT-035 (T-236-b): hiding dotfiles removes dot names in every folder and leaves the rest", () => {
  const shown = withoutDotfiles({ ...kids, [R]: [...kids[R], f(".git", R)], [`${R}/docs`]: [f(".hidden", `${R}/docs`), f("a.md", `${R}/docs`)] });
  expect(shown[R]!.map((n) => n.name)).toEqual(["src", "README.md", "docs"]);
  expect(shown[`${R}/docs`]!.map((n) => n.name)).toEqual(["a.md"]);
});

test("EDIT-035 (T-236-b): the dotfiles switch is remembered per worktree, shown by default, and a bad store reads as shown", () => {
  expect(hidesDotfiles(null, R)).toBe(false);
  const raw = withDotfiles(null, R, true);
  expect(hidesDotfiles(raw, "C:/W")).toBe(true);
  expect(hidesDotfiles(raw, "C:/other")).toBe(false);
  expect(hidesDotfiles(withDotfiles(raw, R, false), R)).toBe(false);
  expect(hidesDotfiles("{not json", R)).toBe(false);
  expect(withDotfiles("{not json", R, true)).toBe(JSON.stringify(["c:/w"]));
  expect(DOTFILES_KEY).toMatch(/dotfiles/i);
});

test("EDIT-035: git-ignored names are left out of the folder that holds them and nothing else", () => {
  const ignored = { [R]: ["README.md", "docs"], [`${R}/src`]: ["missing"] };
  const out = withoutIgnored(kids, ignored);
  expect(out[R]!.map((n) => n.name)).toEqual(["src", ".env"]);
  expect(out[`${R}/src`]).toBe(kids[`${R}/src`]);
  expect(withoutIgnored(kids, {})[R]).toBe(kids[R]);
  expect(IGNORED_KEY).toMatch(/ignored/i);
  // shown by default: only a worktree set to hide them is remembered
  expect(hidesDotfiles(null, R)).toBe(false);
  expect(hidesDotfiles(withDotfiles(null, R, true), R)).toBe(true);
});

test("EDIT-035: a folder read with the same entries is the same list, so the live refresh redraws nothing", () => {
  expect(sameNodes(kids[R], [...kids[R]])).toBe(true);
  expect(sameNodes(kids[R], kids[R].slice(1))).toBe(false);
  expect(sameNodes(kids[R], [...kids[R].slice(0, 3), f("other", R)])).toBe(false);
  expect(sameNodes(undefined, kids[R])).toBe(false);
  expect(sameNodes([{ ...kids[R][0], kind: "file" }, ...kids[R].slice(1)], kids[R])).toBe(false);
});

test("EDIT-035: a file row offers view, a folder row offers search and project, and the terminal item needs a host", () => {
  expect(rowMenu({ isDir: false, hasTerminal: false, canProject: true })).toEqual(["view", "rename", "delete", "copyPath", "copyRelative"]);
  expect(rowMenu({ isDir: false, hasTerminal: true, canProject: false })).toContain("openTerminal");
  const folder = rowMenu({ isDir: true, hasTerminal: true, canProject: true });
  expect(folder).toEqual(["newFile", "newFolder", "findInFolder", "openTerminal", "addProject", "rename", "delete", "copyPath", "copyRelative"]);
  expect(rowMenu({ isDir: true, hasTerminal: true, canProject: false })).not.toContain("addProject");
  expect(rowMenu({ isDir: true, hasTerminal: false, canProject: false })).not.toContain("openTerminal");
});

test("EDIT-035: find in folder limits the search to the folder with an include pattern", () => {
  expect(folderGlob("C:\\w", "C:\\w\\src\\ui")).toBe("src/ui/**");
  expect(folderGlob("C:/w/", "c:/W/src")).toBe("src/**");
  expect(folderGlob("C:/w", "C:/w")).toBe("");
  expect(folderGlob("C:/w", "D:/elsewhere")).toBe("");
});
