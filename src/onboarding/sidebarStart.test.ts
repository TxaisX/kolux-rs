// VIEW-114 (FIX-3, council FIX-SOON 3): the sidebar entry's re-read, tested through the real
// SidebarStart and useGuideState rather than a bare EventTarget. There is no DOM test renderer in
// this repo, so React's three hooks these components use are swapped for a tiny runtime that keeps
// state slots, runs an effect when its deps change and draws again while state is dirty. Children
// are never drawn (JSX only builds elements), so only SidebarStart's own hooks run.
import { afterEach, beforeEach, expect, test, vi } from "vitest";

type Effect = { deps: unknown[] | undefined; cleanup?: () => void };
const h = { slots: [] as unknown[], i: 0, effects: [] as Effect[], e: 0, queue: [] as (() => void)[], dirty: false };

vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  function useState<T>(init: T | (() => T)) {
    const k = h.i++;
    if (!(k in h.slots)) h.slots[k] = typeof init === "function" ? (init as () => T)() : init;
    const set = (v: T | ((x: T) => T)) => {
      const next = typeof v === "function" ? (v as (x: T) => T)(h.slots[k] as T) : v;
      if (!Object.is(next, h.slots[k])) (h.slots[k] = next), (h.dirty = true);
    };
    return [h.slots[k] as T, set] as const;
  }
  function useRef<T>(init: T) {
    const k = h.i++;
    if (!(k in h.slots)) h.slots[k] = { current: init };
    return h.slots[k] as { current: T };
  }
  function useEffect(fn: () => void | (() => void), deps?: unknown[]) {
    const k = h.e++;
    const prev = h.effects[k];
    if (prev && deps && prev.deps && deps.every((d, j) => Object.is(d, prev.deps![j]))) return;
    h.queue.push(() => {
      prev?.cleanup?.();
      const c = fn();
      h.effects[k] = { deps, cleanup: typeof c === "function" ? c : undefined };
    });
  }
  const hooks = { useState, useRef, useEffect };
  return { ...real, ...hooks, default: { ...real, ...hooks } };
});

const calls: string[] = [];
let record: unknown = null;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    calls.push(cmd);
    const answers: Record<string, unknown> = {
      guide_get: record,
      get_settings: { notifyOnFinish: false },
      scm_gh_account: null,
      project_list: [],
      cli_status: { installed: false, onPath: false },
      skills_scan: { skills: [] },
    };
    return cmd in answers ? Promise.resolve(answers[cmd]) : Promise.reject(new Error(`unexpected ${cmd}`));
  },
}));

let win: EventTarget;
beforeEach(() => {
  win = new EventTarget();
  vi.stubGlobal("window", win);
  h.slots = [];
  h.effects = [];
  calls.length = 0;
  record = { tipsSeen: [], visited: [], tried: [], toursSeen: [], toursAuto: null, firstRun: { closed: true, outcome: "dismissed", checklistDismissed: true, milestones: {} } };
});
afterEach(() => vi.unstubAllGlobals());

async function mount() {
  const { default: SidebarStart } = await import("./SidebarStart");
  let out: unknown = null;
  const draw = () => {
    do {
      h.dirty = false;
      h.i = 0;
      h.e = 0;
      h.queue = [];
      out = SidebarStart();
      for (const run of h.queue) run();
    } while (h.dirty);
  };
  const settle = async () => {
    for (let n = 0; n < 8; n++) {
      await new Promise((r) => setTimeout(r, 0));
      if (h.dirty) draw();
    }
  };
  draw();
  await settle();
  return { out: () => out, settle };
}

const reads = () => calls.filter((c) => c === "cli_status").length;

test("a Setup Guide close or an added project makes SidebarStart read its steps again; the entry stays up meanwhile (VIEW-114, FIX-3)", async () => {
  const { GUIDE_CLOSED } = await import("./guide");
  const { PROJECT_ADDED } = await import("./sidebar");
  const app = await mount();
  expect(reads()).toBe(1);
  expect((app.out() as { props: { className: string } }).props.className).toBe("onb-entry");
  win.dispatchEvent(new Event(GUIDE_CLOSED));
  await app.settle();
  expect(reads()).toBe(2);
  win.dispatchEvent(new Event(PROJECT_ADDED));
  await app.settle();
  expect(reads()).toBe(3);
  expect((app.out() as { props: { className: string } }).props.className).toBe("onb-entry");
});

test("the first window focus after mount does not read the steps a second time; one past the floor does (VIEW-114, FIX-3)", async () => {
  const { FOCUS_FLOOR_MS } = await import("./sidebar");
  let mono = 50_000;
  const spy = vi.spyOn(performance, "now").mockImplementation(() => mono);
  try {
    const app = await mount();
    expect(reads()).toBe(1);
    mono += 500;
    win.dispatchEvent(new Event("focus"));
    await app.settle();
    expect(reads()).toBe(1);
    mono += FOCUS_FLOOR_MS;
    win.dispatchEvent(new Event("focus"));
    await app.settle();
    expect(reads()).toBe(2);
  } finally {
    spy.mockRestore();
  }
});
