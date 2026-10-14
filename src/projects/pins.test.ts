import { expect, test } from "vitest";
import { pathKey, pinnedSet, recentOrder } from "./rows";
import { sortFromSetting } from "./rows";

test("PROJ-051: Recent puts the latest activity first and never-seen rows last, keeping their order", () => {
  const rows = ["a", "b", "c", "d"];
  const at: Record<string, number> = { a: 10, c: 30, d: 20 };
  expect(recentOrder(rows, (r) => at[r] ?? 0)).toEqual(["c", "d", "a", "b"]);
});

test("PROJ-051: the new Recent is saved as its own value, so the old Recent-to-Smart move leaves it alone", () => {
  expect(sortFromSetting("activity")).toBe("activity");
  expect(sortFromSetting("recent")).toBe("smart");
});

test("PROJ-051: one key per folder however Git or Windows spelled it", () => {
  expect(pathKey("C:\\Repo\\Wt\\")).toBe("c:/repo/wt");
  expect(pathKey("c:/repo/wt")).toBe("c:/repo/wt");
});

test("PROJ-046: pinning a parent takes its children (at any depth) into the pinned section", () => {
  const ws = [
    { path: "C:\\r\\p", parent: null },
    { path: "C:\\r\\kid", parent: "c:/r/p" },
    { path: "C:\\r\\grandkid", parent: "C:\\r\\kid" },
    { path: "C:\\r\\other", parent: null },
  ];
  expect([...pinnedSet(["c:/r/p"], ws)].sort()).toEqual(["c:/r/grandkid", "c:/r/kid", "c:/r/p"]);
  expect([...pinnedSet([], ws)]).toEqual([]);
  // A loop of parents never hangs.
  expect([...pinnedSet(["a"], [{ path: "a", parent: "b" }, { path: "b", parent: "a" }])].sort()).toEqual(["a", "b"]);
});
