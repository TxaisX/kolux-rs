import { expect, test } from "vitest";
import { EMPTY_HISTORY, navTarget, queryWords, scoreText, travel, visit, type Place } from "./nav";
import { chipFilter, paletteRows, repoOptions, withRepos, worktreeItems, type PaletteItem } from "./WorktreePalette";
import type { Project, Worktree } from "./model";

test("next and previous wrap, a number picks a row", () => {
  expect(navTarget(3, 2, { step: 1 })).toBe(0);
  expect(navTarget(3, 0, { step: -1 })).toBe(2);
  expect(navTarget(3, -1, { step: 1 })).toBe(0);
  expect(navTarget(3, -1, { step: -1 })).toBe(2);
  expect(navTarget(3, 0, { index: 2 })).toBe(1);
  expect(navTarget(3, 0, { index: 4 })).toBeNull();
  expect(navTarget(0, -1, { step: 1 })).toBeNull();
});

const a: Place = { dir: "C:/a", page: null };
const b: Place = { dir: "C:/b", page: null };
const c: Place = { dir: "C:/c", page: null };

test("history keeps a place once at its newest visit and drops what was ahead", () => {
  let h = [a, b, c].reduce(visit, EMPTY_HISTORY);
  expect(visit(h, { dir: "c:/C/", page: null })).toBe(h);
  h = visit(h, a);
  expect(h.list).toEqual([b, c, a]);
  h = { ...h, at: 0 };
  h = visit(h, c);
  expect(h.list).toEqual([b, c]);
  expect(h.at).toBe(1);
});

test("back and forward skip places that are gone", () => {
  const h = { list: [a, b, c], at: 2 };
  expect(travel(h, -1, (p) => p !== b)).toBe(0);
  expect(travel(h, -1, () => false)).toBeNull();
  expect(travel({ ...h, at: 0 }, 1, (p) => p === c)).toBe(2);
  expect(travel(h, 1, () => true)).toBeNull();
});

test("every word has to match, and matches merge", () => {
  const s = (text: string, q: string) => scoreText(text, text.length, queryWords(q))?.spans ?? null;
  expect(s("Fix login page", "LOG  page")).toEqual([[4, 7], [10, 14]]);
  expect(s("Fix login page", "log zebra")).toBeNull();
  expect(s("aaaa", "aa aaa")).toEqual([[0, 3]]);
  expect(s("anything", "")).toEqual([]);
});

test("VIEW-038: exact before prefix before inner or forgiven matches; filler words are dropped", () => {
  const tier = (text: string, q: string) => scoreText(text, text.length, queryWords(q))?.tier ?? null;
  expect(tier("login page", "login")).toBeGreaterThan(tier("logins", "login")!);
  expect(tier("logins", "login")).toBeGreaterThan(tier("relogin", "login")!);
  expect(queryWords("go to Login")).toEqual(["login"]);
  expect(queryWords("open"), "a query of filler alone still searches").toEqual(["open"]);
  expect(tier("fix login", "login nothing")).toBeNull();
  // a single Latin letter: start of a word or a whole word only
  expect(tier("hello world", "l")).toBeNull();
  expect(tier("hello login", "l")).not.toBeNull();
  // small typos only in long words of letters
  expect(tier("login page", "logon")).not.toBeNull();
  expect(tier("fix page", "fx")).toBeNull();
  // accents, full-width forms and CJK fold
  expect(tier("Café menu", "cafe")).not.toBeNull();
  expect(tier("app", "ａｐｐ")).not.toBeNull();
  expect(tier("日本語のテスト", "日本")).not.toBeNull();
});

test("VIEW-038: a number matches only that exact number, with or without #", () => {
  const hit = (text: string, q: string) => scoreText(text, text.length, queryWords(q)) !== null;
  expect(hit("fix-login · #34", "34")).toBe(true);
  expect(hit("fix-login · #34", "#34")).toBe(true);
  expect(hit("other · #340", "34")).toBe(false);
  expect(hit("other · #134", "#34")).toBe(false);
  expect(hit("release v2", "v2")).toBe(true);
  expect(hit("release v20", "v2")).toBe(false);
});

const proj: Project = { id: "p1", name: "app", path: "C:/src/app" };
const ws: Worktree[] = [
  { path: "C:/src/app", branch: "main", head: "1", isMain: true },
  { path: "C:/ws/app/login", branch: "fix-login", head: "2", isMain: false },
  { path: "C:/ws/app/old", branch: "old-thing", head: "3", isMain: false, hidden: true },
];

test("hidden worktrees show only once something is typed; pull requests get their own rows", () => {
  const pr = (d: string) => (d.endsWith("login") ? "open" : null);
  const quiet = worktreeItems([proj], { p1: ws }, false, pr, () => {});
  expect(quiet.filter((i) => i.section === "Worktrees").map((i) => [i.hint, i.parent])).toEqual([["main", "app"], ["fix-login", "app"]]);
  expect(quiet.filter((i) => i.section === "Pull requests").map((i) => i.label)).toEqual(["fix-login"]);
  const typed = worktreeItems([proj], { p1: ws }, true, pr, () => {});
  expect(paletteRows(typed, "old").map((r) => r.section)).toEqual(["Worktrees"]);
});

test("rows come out in section order", () => {
  const it = (section: string, label: string): PaletteItem => ({ section, label, run: () => {} });
  const rows = paletteRows([it("Settings", "Terminal"), it("Open tabs", "terminal 1"), it("Quick actions", "New terminal")], "term");
  expect(rows.map((r) => r.section)).toEqual(["Open tabs", "Settings", "Quick actions"]);
});

const it2 = (section: string, label: string, extra: Partial<PaletteItem> = {}): PaletteItem => ({ section, label, run: () => {}, ...extra });

test("VIEW-038: on a tie the one used last comes first, and open tabs lead", () => {
  const items = [it2("Worktrees", "fix-a", { dir: "C:/a" }), it2("Worktrees", "fix-b", { dir: "C:/b" })];
  expect(paletteRows(items, "fix", ["C:/b", "C:/a"]).map((r) => r.label)).toEqual(["fix-b", "fix-a"]);
  expect(paletteRows(items, "fix", ["C:/a"]).map((r) => r.label)).toEqual(["fix-a", "fix-b"]);
  const tie = [it2("Worktrees", "build"), it2("Open tabs", "build")];
  expect(paletteRows(tie, "build").map((r) => r.section)).toEqual(["Open tabs", "Worktrees"]);
  // the exact match leads, whatever its section
  const mixed = [it2("Open tabs", "login page"), it2("Worktrees", "login")];
  expect(paletteRows(mixed, "login").map((r) => r.label)).toEqual(["login", "login page"]);
  // a match on the row itself beats one found only on its project
  const own = [it2("Worktrees", "login", { parent: "app" }), it2("Worktrees", "app-docs", { parent: "web" })];
  expect(paletteRows(own, "app").map((r) => r.label)).toEqual(["app-docs", "login"]);
  // no query: section order, as listed
  expect(paletteRows([it2("Settings", "x"), it2("Open tabs", "y")], "").map((r) => r.label)).toEqual(["y", "x"]);
});

test("VIEW-041: repository chips keep either repository; different fields must all match", () => {
  const two: Project = { id: "p2", name: "web", path: "C:/src/web" };
  const three: Project = { id: "p3", name: "docs", path: "C:/src/docs" };
  const lists = { p1: ws, p2: [{ path: "C:/src/web", branch: "main", head: "1", isMain: true }], p3: [] };
  const items = withRepos([...worktreeItems([proj, two, three], lists, false, () => null, () => {}), it2("Open tabs", "shell", { dir: "C:\\ws\\app\\login\\src" }), it2("Settings", "Terminal")], lists);
  expect(items.find((i) => i.label === "shell")?.repo).toBe("p1");
  const repos = (chips: { field: "repo" | "section"; value: string }[]) => [...new Set(chipFilter(items, chips).map((i) => i.repo ?? "none"))].sort();
  expect(repos([{ field: "repo", value: "p1" }, { field: "repo", value: "p2" }])).toEqual(["p1", "p2"]);
  expect(chipFilter(items, [{ field: "repo", value: "p1" }, { field: "section", value: "Open tabs" }]).map((i) => i.label)).toEqual(["shell"]);
  expect(chipFilter(items, []).length).toBe(items.length);
  // options sort by workspace count; hidden ones do not count
  expect(repoOptions([three, two, proj], lists).map((o) => [o.id, o.count])).toEqual([["p1", 2], ["p2", 1], ["p3", 0]]);
});

test("VIEW-042: worktree-only actions are not runnable without a worktree", () => {
  const items = [it2("Quick actions", "Remove this workspace", { needs: "worktree" }), it2("Quick actions", "New session")];
  expect(paletteRows(items, "", [], false).map((r) => [r.label, r.off])).toEqual([["Remove this workspace", true], ["New session", false]]);
  expect(paletteRows(items, "", [], true).every((r) => !r.off)).toBe(true);
});
