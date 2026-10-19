import { expect, test } from "vitest";
import { BADGE_CAP, badgeCount } from "./badge";

test("stat048 two workspaces with unseen results read 2 and clear at none", () => {
  expect(badgeCount(new Set(["C:/w/a", "C:/w/b"]))).toBe(2);
  expect(badgeCount(new Set())).toBe(0);
});

test("stat048 unread tabs count once under their workspace, whichever way the path is written", () => {
  // the same workspace folder spelt three ways is one workspace
  expect(badgeCount(["C:/w/a", "C:\\w\\a", "C:/w/a/"])).toBe(1);
});

test("stat048 large counts are capped", () => {
  const many = Array.from({ length: BADGE_CAP + 40 }, (_, i) => `C:/w/${i}`);
  expect(badgeCount(many)).toBe(BADGE_CAP);
});
