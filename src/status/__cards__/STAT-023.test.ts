// STAT-023 acceptance: two sign-in failures in one episode raise exactly one stopped notification naming
// sign-in; a normal finish raises no stopped notification; the 'Agent Stopped' switch is on by default and
// gates it. Drives the real agent-status listener of useAgentEvents (React stand-in as in STAT-007.test.ts),
// with the hook state kept between events so the second failure sees blocked as the previous state.
// Pacer driven: `paced` in src/notify/pace.ts (the one useAgentStatus.ts imports).
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
const sent: { cmd: string; args: Record<string, unknown> }[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    sent.push({ cmd, args });
    return Promise.resolve();
  },
}));
const { useAgentEvents } = await import("../useAgentStatus");
const { resetPacer, KINDS } = await import("../../settings/notifications");

const pane = (key: number, cwd: string) => ({ key, cwd, branch: null, agent: "claude", program: null, args: [] });
const noop = () => {};
const hookRef = { current: { 1: "working", 2: "working" } as Record<number, string> };
const render = (settings: Record<string, unknown> = {}) => {
  ri = 0;
  ei = 0;
  useAgentEvents({ panes: [pane(1, "C:/work/active"), pane(2, "C:/work/other")] as never, setPanes: noop, titles: {}, settings, inView: (k) => k === 1, setToast: noop, tabName: (p) => `Claude ${p.key}`, setCrew: noop, setTurn: noop, setStale: noop, hookRef: hookRef as never, setHook: ((f: (h: Record<number, string>) => Record<number, string>) => (hookRef.current = f(hookRef.current))) as never, setStamp: noop, setContext: noop as never, unreadPanes: new Set(), setUnreadPanes: noop as never, winFocused: false, markDir: noop });
  due.splice(0).forEach((f) => f());
};
const desktop = () => sent.filter((s) => s.cmd === "notify" || s.cmd === "notify_event");
const tick = () => new Promise((r) => setTimeout(r, 30));
const signin = { paneKey: 2, state: "blocked", interrupted: false, boundary: false, children: [], stop: { cause: "signin" } };
const finish = { paneKey: 2, state: "done", interrupted: false, boundary: false, children: [], reply: "Shipped." };

beforeEach(() => {
  refs.length = 0;
  effs.length = 0;
  sent.length = 0;
  hookRef.current = { 1: "working", 2: "working" };
  resetPacer();
});

test("box 1: two sign-in failures in the same episode raise exactly one notification, naming sign-in", async () => {
  render();
  bus["agent-status"]({ payload: signin });
  await tick();
  bus["agent-status"]({ payload: signin });
  await tick();
  expect(desktop()).toHaveLength(1);
  expect(desktop()[0].args).toMatchObject({ title: "other · Claude 2 stopped: sign in again", pane: "2", kind: "stop" });
  // The one account check the sign-in stop asks for is also asked once (STAT-046).
  expect(sent.filter((s) => s.cmd === "claude_account_check")).toHaveLength(1);
});

test("box 2: an agent that finishes normally raises no stopped notification", async () => {
  render();
  bus["agent-status"]({ payload: finish });
  await tick();
  expect(desktop().filter((s) => s.args.kind === "stop")).toHaveLength(0);
  expect(desktop()).toHaveLength(1); // the ordinary finish note, kind finish
  expect(desktop()[0].args).toMatchObject({ kind: "finish" });
});

test("rules: the 'Agent Stopped' switch is on by default, off silences the stop, and 'Agent Task Complete' does not cover it", async () => {
  expect(KINDS.find((k) => k.key === "notifyOnStopped")?.on).toBe(true);
  render({ notifyOnStopped: false });
  bus["agent-status"]({ payload: signin });
  await tick();
  expect(desktop()).toHaveLength(0);
  sent.length = 0;
  hookRef.current = { 1: "working", 2: "working" };
  resetPacer();
  render({ notifyOnFinish: false });
  bus["agent-status"]({ payload: signin });
  await tick();
  expect(desktop()).toHaveLength(1);
});
