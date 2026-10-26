// TERM-118 acceptance: a finish in a hidden tab notifies once and marks it unread; a finish in the pane on screen adds no mark.
// Drives the real agent-status listener of useAgentEvents (React stand-in as in status/notifyFocused.test.ts).
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
const sent: string[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    sent.push(cmd);
    return Promise.resolve();
  },
}));
const { useAgentEvents } = await import("../../status/useAgentStatus");
const { resetPacer } = await import("../../settings/notifications");
const { tabBadge } = await import("../tabs");

const pane = (key: number) => ({ key, cwd: null, branch: null, agent: "claude", program: null, args: [] });
const marks = vi.fn();
const toasts = vi.fn();
const noop = () => {};
// Panes 1 (the tab on screen) and 2 (a hidden tab); both were working before the finish.
const render = (inView: (k: number) => boolean, winFocused = true) => {
  ri = 0;
  ei = 0;
  useAgentEvents({ panes: [pane(1), pane(2)] as never, setPanes: noop, titles: {}, settings: {}, inView, setToast: toasts, tabName: (p) => `Claude ${p.key}`, setCrew: noop, setTurn: noop, setStale: noop, hookRef: { current: { 1: "working", 2: "working" } }, setHook: noop, setStamp: noop, setContext: noop as never, unreadPanes: new Set(), setUnreadPanes: marks as never, winFocused, markDir: noop });
  due.splice(0).forEach((f) => f());
};
const finish = (paneKey: number) => bus["agent-status"]({ payload: { paneKey, state: "done", interrupted: false, children: [] } });
const notes = () => sent.filter((c) => c === "notify" || c === "notify_event").length;
const marked = () => {
  const updater = marks.mock.calls[0]?.[0] as ((u: Set<number>) => Set<number>) | undefined;
  return updater ? [...updater(new Set())] : [];
};

beforeEach(() => {
  refs.length = 0;
  effs.length = 0;
  sent.length = 0;
  marks.mockClear();
  toasts.mockClear();
  resetPacer();
});

test("box 1: an agent finishing in a hidden tab sends one notification and marks the tab unread", async () => {
  render((k) => k === 1, false); // the user is looking elsewhere (Kolux in the background); pane 2 sits in a hidden tab
  finish(2);
  await new Promise((r) => setTimeout(r, 20));
  expect(notes()).toBe(1);
  expect(marked()).toEqual([2]);
  expect(toasts).toHaveBeenCalledWith("Claude 2 finished");
  // App.tsx:3108 feeds unreadPanes.has(key) into tabBadge: the hidden tab shows the unread bell, not the finished check
  expect(tabBadge("claude", true, false, marked().includes(2), "done")).toBe("unread");
});

test("box 1 (focused window): the desktop note is held back by the quiet-while-focused default (STAT-044) but the toast and the unread mark stay", async () => {
  render((k) => k === 1, true);
  finish(2);
  await new Promise((r) => setTimeout(r, 20));
  expect(notes()).toBe(0);
  expect(toasts).toHaveBeenCalledTimes(1);
  expect(marked()).toEqual([2]);
});

test("box 2: an agent finishing in the focused pane that is on screen adds no unread mark", async () => {
  render((k) => k === 1);
  finish(1);
  await new Promise((r) => setTimeout(r, 20));
  expect(marks).not.toHaveBeenCalled();
  expect(toasts).not.toHaveBeenCalled();
  expect(notes()).toBe(0);
  expect(tabBadge("claude", true, false, marked().includes(1), "done")).toBe("done");
});
