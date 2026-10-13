import { expect, test } from "vitest";
import { asleepAfter, renameTo, showSleepingFrom } from "./rows";

test("PROJ-059: Enter saves a trimmed name with shortcodes turned into emoji; blank or unchanged cancels", () => {
  expect(renameTo("  Fix login :fire:  ", "fix-login")).toBe("Fix login \u{1F525}");
  expect(renameTo("   ", "fix-login")).toBeNull();
  expect(renameTo(" fix-login ", "fix-login")).toBeNull();
});

test("PROJ-053: sleeping a workspace puts the ones made from it to sleep too; waking one wakes only it", () => {
  const ws = [
    { path: "C:/R/P", parent: null },
    { path: "C:/R/KID", parent: "C:/R/P" },
    { path: "C:/R/OTHER", parent: null },
  ];
  const slept = asleepAfter([], ws, "C:/R/P", true);
  expect(slept.sort()).toEqual(["c:/r/kid", "c:/r/p"]);
  expect(asleepAfter(slept, ws, "C:/R/KID", false)).toEqual(["c:/r/p"]);
  // Sleeping again adds no duplicates.
  expect(asleepAfter(slept, ws, "C:/R/P", true).sort()).toEqual(["c:/r/kid", "c:/r/p"]);
});

test("VIEW-053: sleeping workspaces are shown on a fresh profile and an explicit opt-out is kept", () => {
  expect(showSleepingFrom(undefined)).toBe(true);
  expect(showSleepingFrom(false)).toBe(false);
  expect(showSleepingFrom(true)).toBe(true);
});
