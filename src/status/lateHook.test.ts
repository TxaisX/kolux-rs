// Review of PR #16 (d): a late Stop or done hook that arrives after a plain terminal's prompt mark must not bring a
// stale status word back. The window's own listener (useAgentEvents) is driven through a caught event bus, as in
// useAgentEvents.test.ts; App.tsx sets the pane's mute from board/chip.ts hooksMuted when the prompt returns.
import { beforeEach, expect, test, vi } from "vitest";

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

type Hooks = Record<number, string>;
let hook: Hooks = {};
let notes: string[] = [];
const none = () => {};
const setHook = (u: Hooks | ((h: Hooks) => Hooks)) => void (hook = typeof u === "function" ? u(hook) : u);
const muted = { current: {} as Record<number, boolean> };
const render = () => {
  ri = 0;
  ei = 0;
  const panes = [{ key: 1, cwd: null, branch: null, agent: "shell", program: null, args: [] }] as never;
  useAgentEvents({ panes, setPanes: none, titles: {}, settings: {}, inView: () => true, setToast: (t: string) => void notes.push(t), tabName: () => "Terminal 1", setCrew: none, setTurn: none, setStale: none, hookRef: { current: hook } as never, setHook: setHook as never, setStamp: none, setContext: none as never, unreadPanes: new Set(), setUnreadPanes: none, winFocused: false, markDir: none, muted } as never);
  due.splice(0).forEach((f) => f());
};
const status = (state: string, extra: object = {}) => bus["agent-status"]({ payload: { paneKey: 1, state, interrupted: false, boundary: false, children: [], ...extra } });

beforeEach(() => {
  refs.length = 0;
  effs.length = 0;
  hook = {};
  notes = [];
  muted.current = {};
});

test("review of PR #16 (d): after the prompt mark, a late Stop/done hook for the plain terminal changes nothing", () => {
  render();
  status("permission");
  expect(hook).toEqual({ 1: "permission" });
  // The prompt came back: App clears the word and mutes the pane (board/chip.ts hooksMuted).
  hook = {};
  muted.current = { 1: true };
  status("done");
  expect(hook, "the late done is ignored").toEqual({});
  status("permission");
  expect(hook).toEqual({});
});

test("review of PR #16 (d): a new agent's own fresh start lifts the mute, and its words count again", () => {
  render();
  muted.current = { 1: true };
  status("idle", { boundary: true, fresh: true });
  expect(muted.current[1]).toBe(false);
  expect(hook).toEqual({ 1: "idle" });
  status("working");
  expect(hook).toEqual({ 1: "working" });
});

test("a pane that is not muted takes every hook word, as before", () => {
  render();
  status("working");
  status("done");
  expect(hook).toEqual({ 1: "done" });
});
