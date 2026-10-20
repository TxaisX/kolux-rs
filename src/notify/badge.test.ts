import { expect, test } from "vitest";
import { BADGE_CAP, badgeCount } from "./badge";

// lane/tray's STAT-048 cases, ported to main's badgeCount(unread pane keys, panes) on the
// 2026-10-20 merge (one badge module serves the tray and the status hooks).
const pane = (key: number, cwd: string | null) => ({ key, cwd });

test("stat048 two workspaces with unseen results read 2 and clear at none", () => {
  const panes = [pane(1, "C:/w/a"), pane(2, "C:/w/b")];
  expect(badgeCount(new Set([1, 2]), panes)).toBe(2);
  expect(badgeCount(new Set<number>(), panes)).toBe(0);
});

test("stat048 unread tabs count once under their workspace, whichever way the path is written", () => {
  // the same workspace folder spelt three ways is one workspace
  const panes = [pane(1, "C:/w/a"), pane(2, "C:\\w\\a"), pane(3, "c:/W/a/")];
  expect(badgeCount([1, 2, 3], panes)).toBe(1);
});

test("stat048 large counts are capped", () => {
  const panes = Array.from({ length: BADGE_CAP + 40 }, (_, i) => pane(i, `C:/w/${i}`));
  expect(badgeCount(panes.map((p) => p.key), panes)).toBe(BADGE_CAP);
});
