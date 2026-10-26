// STAT-041 acceptance: a Codex finish in a workspace that is not on screen raises exactly one desktop
// notification with a preview of the reply; with the finish switch off the next finish raises nothing.
// Drives the real agent-status listener of useAgentEvents (React stand-in as in terminal/__cards__/TERM-118.test.ts).
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

const pane = (key: number, cwd: string) => ({ key, cwd, branch: null, agent: "codex", program: null, args: [] });
const noop = () => {};
// Pane 1 is the workspace on screen; pane 2 runs Codex in another workspace and was working.
const render = (settings: Record<string, unknown>, focused = true) => {
  ri = 0;
  ei = 0;
  useAgentEvents({ panes: [pane(1, "C:/work/active"), pane(2, "C:/work/other")] as never, setPanes: noop, titles: {}, settings, inView: (k) => k === 1, setToast: noop, tabName: (p) => `Codex ${p.key}`, setCrew: noop, setTurn: noop, setStale: noop, hookRef: { current: { 1: "working", 2: "working" } }, setHook: noop, setStamp: noop, setContext: noop as never, unreadPanes: new Set(), setUnreadPanes: noop as never, winFocused: focused, markDir: noop });
  due.splice(0).forEach((f) => f());
};
// The shape src-tauri/tests/cards_04.rs shows a Codex Stop produces: state done, the reply, no boundary.
const codexFinish = (paneKey: number) => bus["agent-status"]({ payload: { paneKey, state: "done", interrupted: false, boundary: false, children: [], reply: "All 14 tests pass.\n\nShipped the fix to the parser." } });
const desktop = () => sent.filter((s) => s.cmd === "notify" || s.cmd === "notify_event");

beforeEach(() => {
  refs.length = 0;
  effs.length = 0;
  sent.length = 0;
  resetPacer();
});

// The user has turned to something else: Kolux is not the focused window, so STAT-044's suppress-while-focused does not apply.
test("box 1: Codex finishing in a workspace that is not active raises exactly one notification with a preview of its reply", async () => {
  render({}, false);
  codexFinish(2);
  await new Promise((r) => setTimeout(r, 30));
  expect(desktop()).toHaveLength(1);
  expect(desktop()[0].cmd).toBe("notify_event");
  expect(desktop()[0].args).toMatchObject({ title: "other · Codex 2 finished", body: "All 14 tests pass. Shipped the fix to the parser.", pane: "2", kind: "finish" });
});

test("box 2: with the finish switch off the next finish raises nothing (box 1 is the same scene with the switch on)", async () => {
  expect(KINDS.find((k) => k.key === "notifyOnFinish")?.on).toBe(true);
  render({ notifyOnFinish: false }, false);
  codexFinish(2);
  await new Promise((r) => setTimeout(r, 30));
  expect(desktop()).toHaveLength(0);
});

test("note (STAT-044): a focused Kolux window holds the desktop note back by default, in any workspace", async () => {
  render({}, true);
  codexFinish(2);
  await new Promise((r) => setTimeout(r, 30));
  expect(desktop()).toHaveLength(0);
});
