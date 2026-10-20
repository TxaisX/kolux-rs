import { beforeEach, expect, test, vi } from "vitest";

const invoke = vi.fn();
const handlers = new Map<string, (e: { payload: unknown }) => void>();
const unlisten = vi.fn();
/** FIX-2: when set, every `listen` registers at once but only completes when the gate opens. */
let gate: Promise<void> | null = null;
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, h: (e: { payload: unknown }) => void) => {
    handlers.set(name, h);
    if (gate) await gate;
    return () => {
      unlisten(name);
      handlers.delete(name);
    };
  },
}));
import { watchStatus, type WatchStart } from "./watch";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  invoke.mockReset();
  unlisten.mockReset();
  handlers.clear();
  gate = null;
  invoke.mockImplementation(async (cmd: string) => (cmd === "scm_watch" ? { id: 7, worktree: "G:/r", watching: true } : undefined));
});

test("GIT-001: a subscription replaces the poll: one watch, statuses arrive by event, no timer", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "setTimeout"], shouldAdvanceTime: true });
  const got: unknown[] = [];
  const stop = watchStatus("G:/r/src/a.ts", (s) => got.push(s));
  await flush();
  expect(invoke).toHaveBeenCalledWith("scm_watch", { path: "G:/r/src/a.ts" });
  expect([...handlers.keys()]).toEqual(["scm-status-7", "scm-watch-ended-7"]); // FIX-1: the ended listener too
  handlers.get("scm-status-7")!({ payload: { branch: "main" } });
  expect(got).toEqual([{ branch: "main" }]);
  // Nothing is asked of git while nothing moves: no status reads on a timer.
  invoke.mockClear();
  vi.advanceTimersByTime(60_000);
  expect(invoke).not.toHaveBeenCalled();
  stop();
  expect(unlisten).toHaveBeenCalledWith("scm-status-7");
  expect(invoke).toHaveBeenCalledWith("scm_unwatch", { id: 7 });
  stop();
  expect(invoke).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});

test("FIX-1: when the back end says the watch ended, the page watches again and statuses keep coming", async () => {
  let n = 0;
  invoke.mockImplementation(async (cmd: string) => (cmd === "scm_watch" ? { id: 7 + n++, worktree: n === 1 ? "G:/r" : "g:\\R\\", watching: true } : undefined));
  const got: unknown[] = [];
  const stop = watchStatus("G:/r/src/a.ts", (s) => got.push(s));
  await flush();
  expect([...handlers.keys()]).toEqual(["scm-status-7", "scm-watch-ended-7"]);
  handlers.get("scm-watch-ended-7")!({ payload: null });
  await flush();
  await flush();
  // The old id is gone on the back end already (never released again); the new one is listened to.
  expect(invoke.mock.calls.filter(([c]) => c === "scm_watch")).toHaveLength(2);
  expect(invoke).not.toHaveBeenCalledWith("scm_unwatch", expect.anything());
  expect(unlisten).toHaveBeenCalledWith("scm-status-7");
  expect(unlisten).toHaveBeenCalledWith("scm-watch-ended-7");
  expect([...handlers.keys()]).toEqual(["scm-status-8", "scm-watch-ended-8"]);
  handlers.get("scm-status-8")!({ payload: { branch: "main" } });
  expect(got).toEqual([{ branch: "main" }]);
  stop();
  expect(invoke).toHaveBeenCalledWith("scm_unwatch", { id: 8 });
  expect(handlers.size).toBe(0);
});

test("FIX-1: watching again after the folder went must not take over another worktree's watch", async () => {
  let n = 0;
  invoke.mockImplementation(async (cmd: string) => (cmd === "scm_watch" ? (n++ === 0 ? { id: 7, worktree: "G:/r/ws/feature", watching: true } : { id: 9, worktree: "G:/r", watching: true }) : undefined));
  const got: unknown[] = [];
  const stop = watchStatus("G:/r/ws/feature", (s) => got.push(s));
  await flush();
  handlers.get("scm-watch-ended-7")!({ payload: null });
  await flush();
  await flush();
  // git answered from the project around the removed workspace: that watch is let go at once.
  expect(invoke).toHaveBeenCalledWith("scm_unwatch", { id: 9 });
  expect(handlers.size).toBe(0);
  invoke.mockClear();
  stop();
  expect(invoke).not.toHaveBeenCalled();
  expect(got).toEqual([]);
});

test("GIT-001: unsubscribing before the watch has started still releases it and never calls back", async () => {
  const got: unknown[] = [];
  const stop = watchStatus("G:/r", (s) => got.push(s));
  stop();
  await flush();
  await flush();
  expect(invoke).toHaveBeenCalledWith("scm_unwatch", { id: 7 });
  expect(handlers.size).toBe(0);
  expect(got).toEqual([]);
});

test("GIT-001: a path outside Git never calls back and needs no release", async () => {
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "scm_watch") throw new Error("not inside a Git worktree");
  });
  const stop = watchStatus("G:/plain", () => {
    throw new Error("must not be called");
  });
  await flush();
  stop();
  expect(invoke).toHaveBeenCalledTimes(1);
});

test("FIX-2: a path outside Git is asked about once, never tried again on a timer", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "scm_watch") throw new Error("not inside a Git worktree");
  });
  const stop = watchStatus("G:/plain", () => {});
  await vi.advanceTimersByTimeAsync(120_000);
  expect(invoke).toHaveBeenCalledTimes(1);
  stop();
  vi.useRealTimers();
});

test("FIX-2: after the folder went, a foreign or failing answer is tried again with backoff until the folder is back", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
  const answers: (WatchStart | Error)[] = [
    { id: 7, worktree: "G:/r/ws/f", watching: true }, // the first watch
    { id: 9, worktree: "G:/r", watching: true }, // right after it ended: git answers from the project around the gone folder
    new Error("could not read the folder"), // 1 s later: the folder is unreadable
    { id: 10, worktree: "G:/r", watching: true }, // 4 s later: still foreign
    { id: 11, worktree: "G:/r", watching: true }, // 15 s later
    { id: 12, worktree: "G:/r", watching: true }, // 30 s later
    { id: 13, worktree: "g:\\R\\ws\\f", watching: true }, // 30 s later: the folder is back
  ];
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd !== "scm_watch") return;
    const a = answers.shift();
    if (a instanceof Error) throw a;
    return a;
  });
  const watches = () => invoke.mock.calls.filter(([c]) => c === "scm_watch").length;
  const got: unknown[] = [];
  const stop = watchStatus("G:/r/ws/f", (s) => got.push(s));
  await tick(0);
  handlers.get("scm-watch-ended-7")!({ payload: null });
  await tick(0);
  // The first try is at once (FIX-1); a foreign answer is let go and the next try waits 1 s.
  expect(watches()).toBe(2);
  expect(invoke).toHaveBeenCalledWith("scm_unwatch", { id: 9 });
  expect(handlers.size).toBe(0);
  await tick(999);
  expect(watches()).toBe(2);
  await tick(1);
  expect(watches()).toBe(3); // 1 s: this one errored
  await tick(3_999);
  expect(watches()).toBe(3);
  await tick(1);
  expect(watches()).toBe(4); // 4 s
  expect(invoke).toHaveBeenCalledWith("scm_unwatch", { id: 10 });
  await tick(15_000);
  expect(watches()).toBe(5); // 15 s
  await tick(30_000);
  expect(watches()).toBe(6); // 30 s
  await tick(30_000);
  expect(watches()).toBe(7); // and every 30 s while mounted: now the folder is back
  expect([...handlers.keys()]).toEqual(["scm-status-13", "scm-watch-ended-13"]);
  handlers.get("scm-status-13")!({ payload: { branch: "main" } });
  expect(got).toEqual([{ branch: "main" }]);
  await tick(120_000);
  expect(watches()).toBe(7); // watching again: no tries on a timer
  stop();
  expect(invoke).toHaveBeenCalledWith("scm_unwatch", { id: 13 });
  expect(handlers.size).toBe(0);
  vi.useRealTimers();
});

test("FIX-2: unsubscribing during the backoff ends the tries", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let n = 0;
  invoke.mockImplementation(async (cmd: string) => (cmd === "scm_watch" ? (n++ === 0 ? { id: 7, worktree: "G:/r/ws/f", watching: true } : { id: 9, worktree: "G:/r", watching: true }) : undefined));
  const stop = watchStatus("G:/r/ws/f", () => {});
  await vi.advanceTimersByTimeAsync(0);
  handlers.get("scm-watch-ended-7")!({ payload: null });
  await vi.advanceTimersByTimeAsync(0);
  expect(n).toBe(2);
  stop();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(n).toBe(2);
  expect(invoke.mock.calls.filter(([c]) => c === "scm_unwatch")).toEqual([["scm_unwatch", { id: 9 }]]);
  vi.useRealTimers();
});

test("FIX-2: both listeners go up together, so the ended listener is not still missing while the status one registers", async () => {
  let open!: () => void;
  gate = new Promise<void>((r) => (open = r));
  const stop = watchStatus("G:/r", () => {});
  await flush();
  // The status listener has not completed (the gate holds it): the ended listener is already registering too.
  expect([...handlers.keys()]).toEqual(["scm-status-7", "scm-watch-ended-7"]);
  open();
  await flush();
  stop();
  expect(handlers.size).toBe(0);
  expect(invoke).toHaveBeenCalledWith("scm_unwatch", { id: 7 });
});
