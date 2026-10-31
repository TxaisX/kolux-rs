// T-609: the changed-file count on a workspace card has a real source: git status for that worktree
// (scm_status, as the Source Control panel and the Inbox read it), not the row's last-change time.
import { expect, test, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const { CardChanges, changedCount } = await import("./cardChanges");
const { cardLine, readCardDetails } = await import("./cards");

const c = (path: string) => ({ path, status: "M", from: null });

test("T-609: the count is each changed path once: staged, changed, untracked and conflicted", () => {
  expect(changedCount({ staged: [c("a.ts"), c("b.ts")], changed: [c("a.ts"), c("c.ts")], untracked: [c("new.md")], conflicts: [] })).toBe(4);
  expect(changedCount({ staged: [], changed: [], untracked: [], conflicts: [] })).toBe(0);
});

test("T-609: each workspace is read once, one at a time, kept for a while, read again on demand; a failed read keeps the last count", async () => {
  let t = 0;
  const asked: string[] = [];
  let inFlight = 0;
  let most = 0;
  const answers: Record<string, number | Error> = { "G:/r/a": 3, "G:/r/b": 0 };
  let bumps = 0;
  const cache = new CardChanges(
    async (p) => {
      asked.push(p);
      inFlight++;
      most = Math.max(most, inFlight);
      await Promise.resolve();
      inFlight--;
      const a = answers[p];
      if (a instanceof Error) throw a;
      return a;
    },
    () => void bumps++,
    () => t,
    10_000,
  );
  expect(cache.countFor("G:/r/a")).toBe(0);
  await cache.load(["G:/r/a", "G:/r/b", "g:\\r\\a\\"]);
  expect(asked).toEqual(["G:/r/a", "G:/r/b"]);
  expect(most, "one git read at a time").toBe(1);
  expect([cache.countFor("G:/r/a"), cache.countFor("G:\\R\\A"), cache.countFor("G:/r/b")]).toEqual([3, 3, 0]);
  expect(bumps, "the cards redraw when a count moves").toBe(1);
  await cache.load(["G:/r/a"]);
  expect(asked, "a fresh answer is not asked again").toHaveLength(2);
  await cache.load(["G:/r/a"], true);
  expect(asked, "an agent finishing there reads it at once").toHaveLength(3);
  t = 20_000;
  answers["G:/r/a"] = new Error("git failed");
  await cache.load(["G:/r/a"]);
  expect(cache.countFor("G:/r/a"), "a failed read keeps the last count").toBe(3);
});

test("T-609: the Default card shows the count from git, not the row's last-change time", () => {
  const { shown } = readCardDetails({});
  // The row's `changed` is a time (App.tsx rowStates: Date.now()); the card's comes from changedCount.
  expect(cardLine(shown, { agents: 1, state: "working", pr: null, changed: 2, note: null })).toBe("1 agent · Working · 2 changed files");
  expect(cardLine(shown, { agents: 0, state: "idle", pr: null, changed: 0, note: null }), "a clean workspace says nothing").toBeNull();
});

test("T-609: the sidebar feeds the card the git count, never RowInfo.changed", async () => {
  const panel = (await import("../projects/ProjectsPanel.tsx?raw")).default;
  expect(panel).toMatch(/changed: cardChanges\.countFor\(w\.path\)/);
  expect(panel).not.toMatch(/changed: info\.changed/);
});
