import { beforeEach, expect, test, vi } from "vitest";
import type { Reading } from "./useAgentStatus";

// USAGE-001 (stand-in review of lane/marks ee2bfbc, FIX-SOON 7): the window's own wiring, not just
// its helpers. A tiny stand-in for React keeps refs and effects across renders (an effect runs when
// its dependencies change), and the event bus is caught, so the real listeners are driven.
const refs: { current: unknown }[] = [];
const effs: { deps?: unknown[]; clean?: () => void }[] = [];
const due: (() => void)[] = [];
let ri = 0;
let ei = 0;
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useRef: (v: unknown) => (refs[ri] ??= { current: v }, refs[ri++]),
  useEffect: (f: () => void | (() => void), deps?: unknown[]) => {
    const i = ei++;
    const old = effs[i];
    if (old && deps && old.deps && deps.every((d, k) => d === old.deps?.[k])) return;
    due.push(() => {
      old?.clean?.();
      const c = f();
      effs[i] = { deps, clean: typeof c === "function" ? c : undefined };
    });
  },
}));
const bus: Record<string, (e: { payload: unknown }) => void> = {};
vi.mock("@tauri-apps/api/event", () => ({ listen: (name: string, f: (e: { payload: unknown }) => void) => ((bus[name] = f), Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve() }));
const { useAgentEvents } = await import("./useAgentStatus");

let context: Record<number, Reading> = {};
// When set, every state update is also run once more on another state, as React may run an
// updater again (Strict Mode, or a rebase over an earlier update); an updater must stay pure.
let replay: Record<number, Reading> | null = null;
const setContext = (u: Record<number, Reading> | ((c: Record<number, Reading>) => Record<number, Reading>)) => {
  if (typeof u !== "function") return void (context = u);
  context = u(context);
  if (replay) u(replay);
};
const none = () => {};
const pane = (key: number) => ({ key, cwd: null, branch: null, agent: "claude", program: null, args: [] });
const render = (keys: number[]) => {
  ri = 0;
  ei = 0;
  const panes = keys.map(pane) as never;
  useAgentEvents({ panes, setPanes: none, titles: {}, settings: {}, inView: () => true, setToast: none, tabName: () => "Claude 1", setCrew: none, setTurn: none, setStale: none, hookRef: { current: {} }, setHook: none, setStamp: none, setContext: setContext as never, unreadPanes: new Set(), setUnreadPanes: none, winFocused: false, markDir: none });
  due.splice(0).forEach((f) => f());
};
const usage = (paneKey: number, tokens: number, session?: string, at?: number) => bus["claude-usage"]({ payload: { paneKey, contextTokens: tokens, contextWindow: 200_000, session, at } });
const clear = (paneKey: number) => bus["agent-status"]({ payload: { paneKey, state: "done", interrupted: false, boundary: true, children: [] } });
// A Claude SessionStart from a start or a resume: a new agent process (`fresh`, marks-FIX-1-hooks.patch).
const resume = (paneKey: number) => bus["agent-status"]({ payload: { paneKey, state: "done", interrupted: false, boundary: true, fresh: true, session: "s1", children: [] } });

beforeEach(() => {
  refs.length = 0;
  effs.length = 0;
  context = {};
  replay = null;
});

test("the listener drops a report for a pane that is not open (USAGE-001)", () => {
  render([1]);
  usage(2, 50_000);
  expect(context).toEqual({});
  usage(1, 50_000);
  expect(context[1]?.tokens).toBe(50_000);
});

test("a clear forgets the reading and sets the floor: a straggler from before it stays out (USAGE-001)", () => {
  render([1]);
  usage(1, 90_000, "s1@2", 60_000);
  clear(1);
  expect(context[1]).toBeUndefined();
  usage(1, 88_000, "s1@2", 59_000);
  usage(1, 90_000, "s1@2", 60_000);
  expect(context[1]).toBeUndefined();
  usage(1, 10_000, "s1@2", 65_000);
  expect(context[1]).toEqual({ tokens: 10_000, window: 200_000, session: "s1@2", at: 65_000 });
});

test("closing a pane forgets its reading and its floor (USAGE-001)", () => {
  render([1, 2]);
  usage(1, 90_000, "s1@2", 60_000);
  usage(2, 40_000);
  clear(1);
  usage(1, 70_000, "s1@2", 61_000);
  render([2]);
  expect(Object.keys(context)).toEqual(["2"]);
  // Back with the same key, nothing of the old pane holds a report back.
  render([1, 2]);
  usage(1, 5_000, "s1@2", 1_000);
  expect(context[1]?.tokens).toBe(5_000);
});

test("different clock strings are separate clocks: a floor on one never holds back the other (USAGE-001)", () => {
  render([1]);
  usage(1, 90_000, "s1@2", 60_000);
  clear(1);
  // The hook server stamps the clock as the session with the terminal that ran it; the resumed
  // Claude's running time starts over, below the floor the clear left.
  usage(1, 30_000, "s1@5", 1_200);
  expect(context[1]).toEqual({ tokens: 30_000, window: 200_000, session: "s1@5", at: 1_200 });
  usage(1, 29_000, "s1@5", 900);
  expect(context[1]?.at).toBe(1_200);
});

test("a resume in the same terminal forgets the reading without a floor: the restarted running time is taken (USAGE-001)", () => {
  // Stand-in review of lane/marks 3efef76, FIX-SOON 1: `claude`, 40 minutes, /exit, then
  // `claude --continue` in the same pane. Same session id, same terminal, so the same clock, and the
  // new process may count its running time from zero again.
  render([1]);
  usage(1, 90_000, "s1@2", 2_400_000);
  resume(1);
  expect(context[1]).toBeUndefined();
  usage(1, 30_000, "s1@2", 1_200);
  expect(context[1]).toEqual({ tokens: 30_000, window: 200_000, session: "s1@2", at: 1_200 });
  // Within the new process the newest still wins.
  usage(1, 29_000, "s1@2", 900);
  expect(context[1]?.at).toBe(1_200);
});

test("a resume also lifts a floor an earlier clear left, even with nothing on screen (USAGE-001)", () => {
  render([1]);
  usage(1, 90_000, "s1@2", 2_400_000);
  clear(1);
  resume(1);
  usage(1, 12_000, "s1@2", 800);
  expect(context[1]?.tokens).toBe(12_000);
});

test("the clear's floor comes from what the pane showed, never from a state update run again (USAGE-001)", () => {
  // Stand-in review of lane/marks 243736d, AFTER 10: the floor was written inside a setContext
  // updater, so React running that updater again on another state moved the floor.
  render([1]);
  usage(1, 90_000, "s1@2", 60_000);
  replay = { 1: { tokens: 1, window: 200_000, session: "x@9", at: 5 } };
  clear(1);
  replay = null;
  usage(1, 88_000, "s1@2", 59_000);
  expect(context[1]).toBeUndefined();
});
