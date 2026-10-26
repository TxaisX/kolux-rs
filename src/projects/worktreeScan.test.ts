import { expect, test } from "vitest";
import type { Project, Worktree } from "./model";
import { SCAN_POOL, ScanGate, scanProjects, type ScanAnswer, type Scanned } from "./worktreeScan";

const project = (n: number) => ({ id: `p${n}`, name: `proj${n}`, path: `C:/r/${n}` }) as Project;
const tree = (path: string, isMain: boolean): Worktree => ({ path, branch: isMain ? "main" : "side", head: "abc", isMain });
const answerOf = (p: Project): Scanned => ({ list: [tree(p.path, true), tree(`${p.path}-wt`, false)], unseen: [] });
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

test("T-442-c: 150 slow projects all answer, at most a small pool at once, each shown as it arrives", async () => {
  const projects = Array.from({ length: 150 }, (_, i) => project(i));
  let live = 0;
  let peak = 0;
  const shown: string[] = [];
  const asked: Promise<void> = scanProjects(
    projects,
    async (p) => {
      live++;
      peak = Math.max(peak, live);
      await wait(2);
      live--;
      return answerOf(p);
    },
    (p, a) => {
      if ("ok" in a) shown.push(p.id);
    },
  );
  // Results land before the sweep is over, not only at its end.
  await wait(30);
  expect(shown.length).toBeGreaterThan(0);
  expect(shown.length).toBeLessThan(150);
  await asked;
  expect(shown.sort()).toEqual(projects.map((p) => p.id).sort());
  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(SCAN_POOL);
});

test("T-442-c: one project failing is reported and the rest still answer", async () => {
  const projects = [project(1), project(2), project(3)];
  const got: Record<string, ScanAnswer> = {};
  await scanProjects(
    projects,
    async (p) => {
      if (p.id === "p2") throw new Error("git timed out");
      return answerOf(p);
    },
    (p, a) => (got[p.id] = a),
  );
  expect("ok" in got.p1!).toBe(true);
  expect(got.p2).toEqual({ error: "Error: git timed out" });
  expect("ok" in got.p3!).toBe(true);
});

test("T-442-c: a poll tick during a scan starts no second scan", async () => {
  const gate = new ScanGate();
  let started = 0;
  let release!: () => void;
  const slow = () => {
    started++;
    return new Promise<void>((r) => (release = r));
  };
  const first = gate.run(slow, { skipIfBusy: true });
  await gate.run(slow, { skipIfBusy: true }); // the 5 s tick: skipped while the scan runs
  await gate.run(slow, { skipIfBusy: true });
  expect(started).toBe(1);
  expect(gate.busy).toBe(true);
  release();
  await first;
  expect(gate.busy).toBe(false);
  const again = gate.run(async () => void started++, { skipIfBusy: true });
  await again;
  expect(started).toBe(2);
});

test("T-442-c: explicit refreshes during a scan run once afterwards, the latest one", async () => {
  const gate = new ScanGate();
  const ran: string[] = [];
  let release!: () => void;
  const first = gate.run(() => new Promise<void>((r) => (release = () => (ran.push("first"), r()))));
  const a = gate.run(async () => void ran.push("a"));
  const b = gate.run(async () => void ran.push("b"));
  expect(ran).toEqual([]);
  release();
  await Promise.all([first, a, b]);
  expect(ran).toEqual(["first", "b"]);
  expect(gate.busy).toBe(false);
});

test("T-442-c: a scan that throws frees the gate", async () => {
  const gate = new ScanGate();
  await expect(gate.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  expect(gate.busy).toBe(false);
  let ran = false;
  await gate.run(async () => void (ran = true));
  expect(ran).toBe(true);
});
