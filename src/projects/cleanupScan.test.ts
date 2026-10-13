import { expect, test } from "vitest";
import { facts, isQuiet, kept, listed, preselected, QUIET_MS, scanCleanup, ticked, type CleanupRow } from "./cleanupScan";

const now = 1_800_000_000_000;
const row = (over: Partial<CleanupRow>): CleanupRow => ({ path: "C:/w/a", branch: "a", head: "1", isMain: false, changes: 0, lastCommit: now - QUIET_MS - 1, merged: false, ...over });

test("PROJ-080: clean, quiet workspaces come preselected; changes, recent work, a lock or an unknown do not", () => {
  expect(preselected(row({}), now)).toBe(true);
  expect(preselected(row({ changes: 2 }), now)).toBe(false);
  expect(preselected(row({ changes: null }), now)).toBe(false);
  expect(preselected(row({ lastCommit: now - 3600_000 }), now)).toBe(false);
  expect(preselected(row({ lastCommit: null }), now)).toBe(false);
  expect(preselected(row({ locked: "" }), now)).toBe(false);
  expect(preselected(row({ locked: "on a stick" }), now)).toBe(false);
  // three idle, clean workspaces: all three
  const three = ["a", "b", "c"].map((n) => row({ path: `C:/w/${n}` }));
  expect(three.filter((r) => preselected(r, now))).toHaveLength(3);
});

test("PROJ-080: quiet or merged ones are listed; every workspace on request", () => {
  const busy = row({ lastCommit: now - 1000 });
  expect(isQuiet(busy, now)).toBe(false);
  expect(listed(busy, now, false)).toBe(false);
  expect(listed({ ...busy, merged: true }, now, false)).toBe(true);
  expect(listed(busy, now, true)).toBe(true);
  expect(listed(row({}), now, false)).toBe(true);
});

test("PROJ-080: rows show plain facts", () => {
  expect(facts(row({ changes: 1, lastCommit: now - 3 * 86400_000, merged: true }), now)).toEqual(["1 change", "last commit 3 days ago", "no commits beyond the default branch"]);
  expect(facts(row({ changes: null, lastCommit: null, merged: null, locked: "" }), now)).toEqual(["changes unknown", "last commit unknown", "Git state unknown", "locked"]);
});

test("PROJ-080: a hand-changed tick is kept", () => {
  const r = row({ path: "C:/w/kept" });
  expect(ticked(r, now)).toBe(true);
  kept.ticks.set(r.path, false);
  expect(ticked(r, now)).toBe(false);
  kept.ticks.clear();
});

test("PROJ-080: opening cleanup twice in quick succession runs one scan", async () => {
  const calls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const scanOne = async (id: string) => {
    calls.push(id);
    await gate;
    if (id === "slow") throw new Error("timed out");
    return [row({ path: `C:/w/${id}` })];
  };
  const projects = ["p", "slow"].map((id) => ({ id, name: id, path: `C:/r/${id}` }));
  const seen: string[] = [];
  const first = scanCleanup(projects, scanOne, (d, t) => seen.push(`first ${d}/${t}`));
  const second = scanCleanup(projects, scanOne, (d, t) => seen.push(`second ${d}/${t}`));
  expect(second).toBe(first);
  release();
  const out = await second;
  expect(calls).toEqual(["p", "slow"]);
  expect(seen).toEqual(["second 1/2", "second 2/2"]);
  expect(out.repos[1].error).toContain("timed out");
  expect(out.repos[0].rows).toHaveLength(1);
  // once it is over, the next open starts a new one
  await scanCleanup(projects, scanOne, () => {});
  expect(calls).toHaveLength(4);
});
