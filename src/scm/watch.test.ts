import { beforeEach, expect, test, vi } from "vitest";

const invoke = vi.fn();
const handlers = new Map<string, (e: { payload: unknown }) => void>();
const unlisten = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, h: (e: { payload: unknown }) => void) => {
    handlers.set(name, h);
    return () => {
      unlisten(name);
      handlers.delete(name);
    };
  },
}));
import { watchStatus } from "./watch";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  invoke.mockReset();
  unlisten.mockReset();
  handlers.clear();
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
