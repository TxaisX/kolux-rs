// STAT-007 acceptance: after /compact the pane settles with no completion notification.
// The status src-tauri/tests/cards_04.rs shows a manual PostCompact produces (state done, boundary true)
// goes through the real agent-status listener of useAgentEvents (React stand-in as in terminal/__cards__/TERM-118.test.ts).
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
const { useAgentEvents } = await import("../useAgentStatus");
const { resetPacer } = await import("../../settings/notifications");

const pane = (key: number, cwd: string) => ({ key, cwd, branch: null, agent: "claude", program: null, args: [] });
const noop = () => {};
const toasts = vi.fn();
const render = () => {
  ri = 0;
  ei = 0;
  useAgentEvents({ panes: [pane(1, "C:/work/active"), pane(2, "C:/work/other")] as never, setPanes: noop, titles: {}, settings: {}, inView: (k) => k === 1, setToast: toasts, tabName: (p) => `Claude ${p.key}`, setCrew: noop, setTurn: noop, setStale: noop, hookRef: { current: { 1: "working", 2: "working" } }, setHook: noop, setStamp: noop, setContext: noop as never, unreadPanes: new Set(), setUnreadPanes: noop as never, winFocused: false, markDir: noop });
  due.splice(0).forEach((f) => f());
};
const desktop = () => sent.filter((c) => c === "notify" || c === "notify_event");

beforeEach(() => {
  refs.length = 0;
  effs.length = 0;
  sent.length = 0;
  toasts.mockClear();
  resetPacer();
});

test("box 2: /compact settles the pane as a boundary done and raises no notification", async () => {
  render();
  bus["agent-status"]({ payload: { paneKey: 2, state: "done", interrupted: false, boundary: true, children: [] } });
  await new Promise((r) => setTimeout(r, 30));
  expect(desktop()).toHaveLength(0);
  expect(toasts).not.toHaveBeenCalled();
});

test("control: the same pane's real finish (no boundary) does raise a notification, so the silence above is the boundary's", async () => {
  render();
  bus["agent-status"]({ payload: { paneKey: 2, state: "done", interrupted: false, boundary: false, children: [], reply: "Done." } });
  await new Promise((r) => setTimeout(r, 30));
  expect(desktop()).toHaveLength(1);
});
