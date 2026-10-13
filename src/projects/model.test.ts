import { expect, test } from "vitest";
import { afterScan, prefixSample, folderName, matchLetters, middle, pathHints, rankProjects, shortcodes, openedWorktree, relPath, nestRows, orderWorktrees, parentChoices, placeFieldAction, previewSentence, worktreeLabel, type Worktree, createOpens, failureOf, pushLabel, newestOnly } from "./model";

test("PROJ-068: a refresh that comes back after a newer one started is dropped", () => {
  const ticket = newestOnly();
  const older = ticket();
  expect(older()).toBe(true);
  const newer = ticket();
  expect(older()).toBe(false);
  expect(newer()).toBe(true);
});

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

test("New workspace with no project yet opens the add-project form instead of a dead name field (T-013-fix-a)", () => {
  expect(createOpens("")).toBe("add");
  expect(createOpens("app-1")).toBe("name");
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

// SESS-035: the composer's project list.
test("typed letters are found in order, a run of them beats scattered ones, and recent projects lead", () => {
  expect(matchLetters("api", "my-api")).toEqual([3, 4, 5]);
  expect(matchLetters("ai", "my-api")).toEqual([3, 5]);
  expect(matchLetters("zz", "my-api")).toBeNull();
  const ps = [
    { id: "1", name: "alpha-pi", path: "C:/src/alpha-pi" },
    { id: "2", name: "api", path: "C:/work/api" },
    { id: "3", name: "notes", path: "C:/notes" },
  ];
  const r = rankProjects(ps, "api", []);
  expect(r.recent).toEqual([]);
  expect(r.rest.map((m) => m.p.id)).toEqual(["2", "1"]);
  expect(rankProjects(ps, "api", ["1"]).recent.map((m) => m.p.id)).toEqual(["1"]);
  expect(rankProjects(ps, "", ["3"]).rest.map((m) => m.p.id)).toEqual(["1", "2"]);
});

test("projects sharing a name get enough of their path to tell them apart, long text shortened in the middle", () => {
  const hints = pathHints([
    { id: "a", name: "api", path: "C:/work/client/api" },
    { id: "b", name: "api", path: "D:/home/client/api" },
    { id: "c", name: "web", path: "C:/web" },
  ]);
  expect(hints).toEqual({ a: "work/client", b: "home/client" });
  expect(pathHints([
    { id: "w", name: "api", path: "C:\\one\\client\\api" },
    { id: "v", name: "api", path: "C:\\two\\client\\api" },
  ])).toEqual({ w: "one\\client", v: "two\\client" });
  expect(middle("abcdefghij", 7)).toBe("abc…hij");
  expect(middle("short", 7)).toBe("short");
});

// SESS-036: emoji shortcodes in the name.
test("emoji shortcodes turn into emoji and unknown ones are left alone", () => {
  expect(shortcodes("Fix :bug: fast :rocket:")).toBe("Fix \u{1F41B} fast \u{1F680}");
  expect(shortcodes(":nope: a:b")).toBe(":nope: a:b");
});

test("ACCT-056: a failed scan keeps the worktrees already known; a scan that worked replaces them", () => {
  const known = [{ path: "C:/r/a", branch: "a", head: "1", isMain: false }];
  expect(afterScan(known, null)).toBe(known);
  expect(afterScan(undefined, null)).toEqual([]);
  expect(afterScan(known, [])).toEqual([]);
});

test("SET-031: the prefix field shows the next branch name and says when the prefix is not used", () => {
  expect(prefixSample("custom", "tx", { prefix: "tx/", refused: false })).toEqual({ sample: "tx/<name>", note: null });
  expect(prefixSample("custom", "a b", { prefix: "", refused: true })).toEqual({ sample: "<name>", note: 'Git does not accept "a b" in a branch name, so new branches get no prefix.' });
  expect(prefixSample("custom", " /// ", { prefix: "", refused: false }).note).toBe("A prefix of only slashes is no prefix, so new branches get the bare name.");
  expect(prefixSample("user", "", { prefix: "txais-xiong/", refused: false })).toEqual({ sample: "txais-xiong/<name>", note: null });
  expect(prefixSample("none", "tx", null)).toEqual({ sample: "<name>", note: null });
});

test("PROJ-048: a new parent is never the workspace itself, its parent, its descendants or the main checkout", () => {
  const w = (name: string, parent?: string): Worktree => ({ path: "C:/ws/" + name, branch: name, head: "c", isMain: false, parent: parent && "C:/ws/" + parent });
  const all = [main, w("p"), w("a", "p"), w("kid", "a"), w("grand", "kid"), w("b"), w("loop1", "loop2"), w("loop2", "loop1")];
  const names = (x: Worktree) => parentChoices(all, x).map((c) => c.branch);
  expect(names(all[2])).toEqual(["b", "loop1", "loop2"]);
  expect(names(all[5])).toEqual(["p", "a", "kid", "grand", "loop1", "loop2"]);
  // a loop of parents does not hang the walk, and the other loop member is a descendant
  expect(names(all[6])).toEqual(["p", "a", "kid", "grand", "b"]);
  // a parent that is no longer listed is not "the current parent"
  expect(names(w("lost", "gone"))).toEqual(["p", "a", "kid", "grand", "b", "loop1", "loop2"]);
});

test("PROJ-031: a failed create shows its words, and Git's output only when it adds something", () => {
  expect(failureOf({ kind: "name", message: "That name is in use.", detail: "fatal: x already exists" })).toEqual({ text: "That name is in use.", detail: "fatal: x already exists" });
  expect(failureOf({ kind: "other", message: "Gone.", detail: "Gone" })).toEqual({ text: "Gone.", detail: null });
  expect(failureOf("plain words")).toEqual({ text: "plain words", detail: null });
  expect(failureOf(new Error("boom")).text).toBe("boom");
});

test("PROJ-064: a row says how many commits are not pushed", () => {
  expect(pushLabel(null)).toBeNull();
  expect(pushLabel({ ahead: 2, upstream: true })).toEqual({ text: "2 ahead", title: "2 commits not pushed yet" });
  expect(pushLabel({ ahead: 0, upstream: true })?.text).toBe("in sync");
  expect(pushLabel({ ahead: 1, upstream: false })).toEqual({ text: "unpublished · 1", title: "This branch has no upstream yet; 1 commit on no remote" });
  expect(pushLabel({ ahead: 0, upstream: false })?.text).toBe("unpublished");
});
