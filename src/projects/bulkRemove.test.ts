import { describe, expect, it } from "vitest";
import type { Cleaned, ScanRow } from "./cleanup";
import { canStart, finished, hasCandidates, lossKinds, namedList, removeOne, runBulk, summary, unchecked, type RemoveResult } from "./bulkRemove";

const row = (path: string, extra: Partial<ScanRow> = {}): ScanRow => ({
  path, branch: null, name: null, idleDays: 30, changes: 0, merged: true, unmerged: false, active: false, locked: false,
  missing: false, quiet: true, preselect: true, keepsBranch: false, note: null, ...extra,
});
const ok: RemoveResult = { ok: true, why: null };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("PROJ-082 the question before a bulk removal", () => {
  it("names each kind of local context that will be lost, and only kinds that are present", () => {
    const clean = [row("/w/a")];
    expect(lossKinds(clean)).toHaveLength(1);
    expect(lossKinds(clean)[0]).toMatch(/not track/);
    const mixed = [row("/w/a", { changes: 3 }), row("/w/b", { unmerged: true, merged: false, keepsBranch: true }), row("/w/c", { active: true })];
    const words = lossKinds(mixed).join(" | ");
    expect(words).toMatch(/uncommitted changes \(1 workspace\)/);
    expect(words).toMatch(/commits no other branch has \(1 workspace; the branch is kept\)/);
    expect(words).toMatch(/open terminal \(1 workspace\)/);
  });

  it("names nothing for a folder that is already gone, and nothing for an empty selection", () => {
    expect(lossKinds([row("/w/a", { missing: true })])).toEqual([]);
    expect(lossKinds([])).toEqual([]);
  });

  it("lists a large selection by name only up to the limit, then counts the rest", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(`/w/n${i}`));
    const l = namedList(rows);
    expect(l.names).toHaveLength(8);
    expect(l.more).toBe(22);
    expect(namedList(rows.slice(0, 3))).toEqual({ names: ["n0", "n1", "n2"], more: 0 });
  });

  it("starts nothing when no candidates are left", () => {
    expect(hasCandidates([])).toBe(false);
    expect(canStart([], true)).toBe(false);
    expect(canStart([row("/w/a")], false)).toBe(true);
  });

  it("makes a row whose safety could not be checked wait for explicit agreement", () => {
    const rows = [row("/w/a"), row("/w/b", { note: "Its details could not be read: boom" })];
    expect(unchecked(rows).map((r) => r.path)).toEqual(["/w/b"]);
    expect(canStart(rows, false)).toBe(false);
    expect(canStart(rows, true)).toBe(true);
  });
});

describe("PROJ-082 the background run", () => {
  it("removes children first, reports progress, and counts everything removed", async () => {
    const order: string[] = [];
    const seen: string[] = [];
    const items = await runBulk(["/w/top", "/w/kid"], (p) => ({ "/w/kid": "/w/top" } as Record<string, string>)[p], async (p) => (order.push(p), ok), { onProgress: (i) => seen.push(summary(i)) });
    expect(order).toEqual(["/w/kid", "/w/top"]);
    expect(items.map((i) => i.state)).toEqual(["removed", "removed"]);
    expect(seen[0]).toBe("Removed 0 of 2");
    expect(seen[seen.length - 1]).toBe("Removed 2 of 2");
    expect(finished(items)).toBe(2);
  });

  it("skips a parent whose child failed, and says so", async () => {
    const order: string[] = [];
    const items = await runBulk(["/w/kid", "/w/top", "/w/solo"], (p) => ({ "/w/kid": "/w/top" } as Record<string, string>)[p], async (p) => (order.push(p), p === "/w/kid" ? { ok: false, why: "it is locked" } : ok));
    expect(order).toEqual(["/w/kid", "/w/solo"]);
    expect(items.map((i) => [i.path, i.state])).toEqual([["/w/kid", "left"], ["/w/top", "skipped"], ["/w/solo", "removed"]]);
    expect(items.find((i) => i.path === "/w/kid")?.why).toBe("it is locked");
    expect(items.find((i) => i.path === "/w/top")?.why).toMatch(/stays/);
    expect(summary(items)).toBe("Removed 1 of 3 · 2 left in place");
  });

  it("counts a removal that timed out but later succeeded as removed, and its parent goes after it", async () => {
    const order: string[] = [];
    const states: string[] = [];
    const items = await runBulk(
      ["/w/kid", "/w/top"],
      (p) => ({ "/w/kid": "/w/top" } as Record<string, string>)[p],
      async (p) => {
        if (p === "/w/kid") await sleep(60);
        order.push(p);
        return ok;
      },
      { slowMs: 10, onProgress: (i) => states.push(i[0].state) },
    );
    expect(states).toContain("slow");
    expect(order).toEqual(["/w/kid", "/w/top"]);
    expect(items.map((i) => i.state)).toEqual(["removed", "removed"]);
  });

  it("lets a slow sibling run on while the next one starts", async () => {
    const order: string[] = [];
    await runBulk(["/w/a", "/w/b"], () => null, async (p) => {
      if (p === "/w/a") await sleep(60);
      order.push(p);
      return ok;
    }, { slowMs: 10 });
    expect(order).toEqual(["/w/b", "/w/a"]);
  });

  it("leaves the parent when a slow child fails late", async () => {
    const items = await runBulk(["/w/kid", "/w/top"], (p) => ({ "/w/kid": "/w/top" } as Record<string, string>)[p], async (p) => {
      await sleep(p === "/w/kid" ? 40 : 0);
      return p === "/w/kid" ? { ok: false, why: "late failure" } : ok;
    }, { slowMs: 10 });
    expect(items.map((i) => i.state)).toEqual(["left", "skipped"]);
  });

  it("turns a thrown removal into a left-in-place row and keeps going", async () => {
    const items = await runBulk(["/w/a", "/w/b"], () => null, async (p) => {
      if (p === "/w/a") throw new Error("boom");
      return ok;
    });
    expect(items.map((i) => i.state)).toEqual(["left", "removed"]);
    expect(items[0].why).toMatch(/boom/);
  });

  it("calls the existing one-at-a-time command and reads its result", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const kept: string[] = [];
    const answers: Cleaned[] = [
      { removed: ["/w/a"], left: [], kept: [{ branch: "feat", commit: "abc" }] },
      { removed: [], left: [{ path: "/w/b", why: "it has changes" }], kept: [] },
    ];
    const invoke = async <T,>(cmd: string, args: Record<string, unknown>): Promise<T> => (calls.push([cmd, args]), answers.shift() as T);
    const one = removeOne("p1", (k) => kept.push(...k.map((b) => b.branch)), invoke);
    expect(await one("/w/a")).toEqual({ ok: true, why: null });
    expect(await one("/w/b")).toEqual({ ok: false, why: "it has changes" });
    expect(calls).toEqual([["cleanup_remove", { projectId: "p1", paths: ["/w/a"] }], ["cleanup_remove", { projectId: "p1", paths: ["/w/b"] }]]);
    expect(kept).toEqual(["feat"]);
  });
});
