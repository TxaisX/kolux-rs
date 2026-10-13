import { expect, test } from "vitest";
import { EMPTY_HISTORY, matchWords, navTarget, travel, visit, wordsOf, type Place } from "./nav";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { RowMark, dirMark, paletteAge, paletteRows, worktreeItems, type PaletteItem } from "./WorktreePalette";
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

test("palette rows carry the agent's mark, permission over unread over a fresh finish (VIEW-040)", () => {
  expect(dirMark("permission", true)).toBe("permission");
  expect(dirMark("waiting", true)).toBe("permission");
  expect(dirMark("working", false)).toBe("working");
  expect(dirMark("done", true)).toBe("unread");
  expect(dirMark("done", false)).toBe("done");
  expect(dirMark("idle", false)).toBeNull();
  expect(dirMark(null, true)).toBe("unread");
  const at = (d: string) => (d.endsWith("login") ? { mark: "permission" as const, since: 5 } : null);
  const items = worktreeItems([proj], { p1: ws }, false, () => null, () => {}, at);
  expect(items.filter((i) => i.section === "Worktrees").map((i) => i.mark ?? null)).toEqual([null, "permission"]);
  const html = renderToStaticMarkup(createElement(RowMark, { mark: "permission", since: 1, now: 1 + 50 * 60_000 }));
  expect(html).toContain('aria-label="needs permission"');
  expect(html).toContain(">50m<");
  expect(renderToStaticMarkup(createElement(RowMark, { mark: "unread", since: 0, now: 0 }))).toContain('aria-label="unread"');
  expect(renderToStaticMarkup(createElement(RowMark, { mark: null, since: 0, now: 0 }))).toBe("");
});

test("ages read in minutes for the first hour, hours until two days, then days (VIEW-040)", () => {
  const m = 60_000;
  const h = 60 * m;
  expect(paletteAge(0, 30_000)).toBe("now");
  expect(paletteAge(0, 4 * m)).toBe("4m");
  expect(paletteAge(0, 50 * m)).toBe("50m");
  expect(paletteAge(0, 60 * m - 1)).toBe("59m");
  expect(paletteAge(0, h)).toBe("1h");
  expect(paletteAge(0, 3 * h)).toBe("3h");
  expect(paletteAge(0, 48 * h - 1)).toBe("47h");
  expect(paletteAge(0, 48 * h)).toBe("2d");
  expect(paletteAge(0, 72 * h)).toBe("3d");
});
