import { expect, test } from "vitest";
import { EMPTY_HISTORY, matchWords, navTarget, travel, visit, wordsOf, type Place } from "./nav";
import { paletteRows, worktreeItems, type PaletteItem } from "./WorktreePalette";
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
  expect(matchWords("Fix login page", wordsOf("LOG  page"))).toEqual([[4, 7], [10, 14]]);
  expect(matchWords("Fix login page", wordsOf("log pager"))).toBeNull();
  expect(matchWords("aaaa", ["aa", "aaa"])).toEqual([[0, 4]]);
  expect(matchWords("anything", [])).toEqual([]);
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
  expect(quiet.filter((i) => i.section === "Worktrees").map((i) => i.hint)).toEqual(["app · main", "app · fix-login"]);
  expect(quiet.filter((i) => i.section === "Pull requests").map((i) => i.label)).toEqual(["fix-login"]);
  const typed = worktreeItems([proj], { p1: ws }, true, pr, () => {});
  expect(paletteRows(typed, "old").map((r) => r.section)).toEqual(["Worktrees"]);
});

test("rows come out in section order", () => {
  const it = (section: string, label: string): PaletteItem => ({ section, label, run: () => {} });
  const rows = paletteRows([it("Settings", "Terminal"), it("Open tabs", "terminal 1"), it("Quick actions", "New terminal")], "term");
  expect(rows.map((r) => r.section)).toEqual(["Open tabs", "Settings", "Quick actions"]);
});
