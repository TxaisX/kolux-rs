// VIEW-023 acceptance (and the line VIEW-016 / the buttons of VIEW-025 read): the Board card's chip, built from
// the agent-status payloads the real useAgentEvents listener receives (shapes asserted in src-tauri/tests/cards_05.rs).
// MIRROR src/App.tsx:2299 chipFor: the signal is { agent, state: hook[pane], running, stale, ...turn[pane], since }.
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
const { useAgentEvents } = await import("../../status/useAgentStatus");
const { chipOf, LANES } = await import("../chip");

type Hook = Record<number, string>;
type Turn = Record<number, Record<string, unknown>>;
let hook: Hook = {};
let turn: Turn = {};
const apply = <T>(cur: T, u: unknown): T => (typeof u === "function" ? (u as (c: T) => T)(cur) : (u as T));
const noop = () => {};
const pane = { key: 1, cwd: "C:/w/app", branch: null, agent: "claude", program: null, args: [] };

function listen() {
  ri = 0;
  ei = 0;
  useAgentEvents({
    panes: [pane] as never, setPanes: noop, titles: {}, settings: {}, inView: () => true, setToast: noop, tabName: () => "Claude 1",
    setCrew: noop, setTurn: ((u: unknown) => { turn = apply(turn, u); }) as never, setStale: noop, hookRef: { current: hook } as never,
    setHook: ((u: unknown) => { hook = apply(hook, u); }) as never, setStamp: noop, setContext: noop as never,
    unreadPanes: new Set(), setUnreadPanes: noop as never, winFocused: true, markDir: noop,
  });
  due.splice(0).forEach((f) => f());
}
const send = (payload: Record<string, unknown>) => bus["agent-status"]({ payload: { paneKey: 1, interrupted: false, boundary: false, children: [], ...payload } });
const NOW = 1_000_000;
const chip = () => chipOf({ agent: "claude", state: hook[1] as never, running: true, stale: false, ...turn[1], since: NOW - 4 * 60_000 } as never, NOW);

beforeEach(() => {
  refs.length = 0;
  effs.length = 0;
  hook = {};
  turn = {};
  listen();
});

test("box 1: an agent stopped by a usage limit sits in the Stopped lane and its chip says Stopped", () => {
  send({ state: "working" });
  send({ state: "blocked", stop: { cause: "limit", detail: "5-hour limit" } });
  expect(chip()).toMatchObject({ lane: "stopped", word: "Stopped" });
  expect(chip()?.line).toContain("Limit reached");
  expect(LANES.find((l) => l.id === chip()?.lane)?.title).toBe("Stopped");
});

test("box 2: a finished agent's chip shows the first line of its last message", () => {
  send({ state: "working" });
  send({ state: "done", reply: "\nAll 14 tests pass.\n\nShipped the fix." });
  expect(chip()).toMatchObject({ lane: "done", word: "Done", line: "All 14 tests pass." });
});

test("box 3: an agent that writes file A, then file B, then finishes links the card to file B", () => {
  send({ state: "working", wrote: "C:/w/a.ts" });
  expect(chip()?.file).toBeUndefined(); // still working: no file link yet
  send({ state: "working", wrote: "C:/w/b.ts" });
  send({ state: "done", reply: "Done." });
  expect(chip()).toMatchObject({ lane: "done", word: "Done", file: "C:/w/b.ts" });
});
