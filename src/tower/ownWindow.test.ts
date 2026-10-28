import { expect, test, vi } from "vitest";
import { createViaRust, isTowerWindow, openTowerWindow, pickScreen, snapshotChanged, TOWER_HASH, TOWER_LABEL, type Screen, type WindowApi } from "./ownWindow";

const main: Screen = { x: 0, y: 0, width: 2560, height: 1440, scale: 1.25 };
const left: Screen = { x: -1920, y: 0, width: 1920, height: 1080, scale: 1 };

const api = (o: Partial<WindowApi> & { made?: Array<{ label: string; opts: Record<string, unknown> }> } = {}): WindowApi & { made: Array<{ label: string; opts: Record<string, unknown> }> } => {
  const made = o.made ?? [];
  return {
    made,
    focus: o.focus ?? (async () => false),
    screens: o.screens ?? (async () => ({ all: [main, left], current: main })),
    create: o.create ?? (async (label, opts) => (made.push({ label, opts }), true)),
  };
};

test("T-546-c: the Tower opens on a screen other than the one the main window is on", () => {
  expect(pickScreen([main, left], main)).toEqual(left);
  expect(pickScreen([left, main], main)).toEqual(left);
  expect(pickScreen([main], main)).toBeNull();
  expect(pickScreen([], null)).toBeNull();
});

test("T-546-c: a new Tower window is made on the second screen, filling it, at logical coordinates", async () => {
  const a = api();
  expect(await openTowerWindow(a)).toBe("opened");
  expect(a.made).toHaveLength(1);
  expect(a.made[0].label).toBe(TOWER_LABEL);
  expect(a.made[0].opts).toMatchObject({ url: `index.html${TOWER_HASH}`, x: -1920, y: 0, width: 1920, height: 1080, maximized: true });
});

test("T-546-c: with one screen the Tower window opens centred on it, not maximised over the main window", async () => {
  const a = api({ screens: async () => ({ all: [main], current: main }) });
  expect(await openTowerWindow(a)).toBe("opened");
  expect(a.made[0].opts).toMatchObject({ center: true, maximized: false });
  expect(a.made[0].opts.x).toBeUndefined();
});

test("T-546-c: an open Tower window is brought forward instead of a second one being made", async () => {
  const a = api({ focus: async () => true });
  expect(await openTowerWindow(a)).toBe("focused");
  expect(a.made).toHaveLength(0);
});

test("T-546-c: a window that cannot be made (no permission, an error) reports failed, so the Tower stays a switcher screen", async () => {
  expect(await openTowerWindow(api({ create: async () => false }))).toBe("failed");
  expect(await openTowerWindow(api({ create: async () => Promise.reject(new Error("not allowed")) }))).toBe("failed");
  expect(await openTowerWindow(api({ focus: async () => Promise.reject(new Error("not allowed")), create: async () => false }))).toBe("failed");
  // screens unknown: still tries, centred
  const a = api({ screens: async () => Promise.reject(new Error("no monitors")) });
  expect(await openTowerWindow(a)).toBe("opened");
  expect(a.made[0].opts).toMatchObject({ center: true });
});

test("T-546-c: the Tower window is told apart by its address", () => {
  expect(isTowerWindow(TOWER_HASH)).toBe(true);
  expect(isTowerWindow("")).toBe(false);
  expect(isTowerWindow("#other")).toBe(false);
});

test("T-546-c: the main window sends the Tower window a snapshot only when what it shows changed", () => {
  const s = { seats: [{ key: 1, agent: "claude", title: "a", branch: null, cwd: null, account: null, chip: null, meter: null, since: 0 }], usage: [] };
  expect(snapshotChanged(null, s)).toBe(true);
  expect(snapshotChanged(s, JSON.parse(JSON.stringify(s)))).toBe(false);
  expect(snapshotChanged(s, { ...s, seats: [{ ...s.seats[0], title: "b" }] })).toBe(true);
});

// FIX-3 (council FIX-SOON 3): two quick clicks on Own window used to both miss focus() and both make
// the window; the second got "label taken" and reported failed while the window was up. Clicks that
// land while one open is under way now share its answer, and only one window is made.
test("FIX-3: a second click while the Tower window is being made shares the first click's answer", async () => {
  let finish: (ok: boolean) => void = () => {};
  const made: string[] = [];
  const a = api({
    // the first make is slow; a make while that window exists fails as the label is taken
    create: (label) => {
      made.push(label);
      return made.length === 1 ? new Promise<boolean>((r) => (finish = r)) : Promise.resolve(false);
    },
  });
  const first = openTowerWindow(a);
  const second = openTowerWindow(a);
  await new Promise((r) => setTimeout(r, 0));
  finish(true);
  expect(await Promise.all([first, second])).toEqual(["opened", "opened"]);
  expect(made).toHaveLength(1);
  // once that open is over, the next click asks again (here: the window is up, so it is brought forward)
  expect(await openTowerWindow(api({ focus: async () => true }))).toBe("focused");
});

// FIX-4 (council d2 AFTER 6): the main window asks "did the snapshot change?" on every render. The
// answer is free when the seats and the usage are the very same lists, and the kept snapshot is
// written out once, not once per render.
test("FIX-4: snapshotChanged does not write the snapshots out again on every render", () => {
  const seat = { key: 1, agent: "claude", title: "a", branch: null, cwd: null, account: null, chip: null, meter: null, since: 0 };
  const last = { seats: [seat], usage: [] };
  const spy = vi.spyOn(JSON, "stringify");
  try {
    // the same lists again: nothing to compare
    expect(snapshotChanged(last, { seats: last.seats, usage: last.usage })).toBe(false);
    expect(spy).toHaveBeenCalledTimes(0);
    // a different number of seats: changed without writing anything out
    expect(snapshotChanged(last, { seats: [], usage: [] })).toBe(true);
    expect(spy).toHaveBeenCalledTimes(0);
    // equal by value, new lists, three renders in a row: the kept snapshot is written out once
    for (let i = 0; i < 3; i++) expect(snapshotChanged(last, { seats: [{ ...seat }], usage: [] })).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1 + 3);
    expect(snapshotChanged(last, { seats: [{ ...seat, title: "b" }], usage: [] })).toBe(true);
  } finally {
    spy.mockRestore();
  }
});

// Rows 955 / 959: made from the page, the Tower window passed no browser arguments and the engine
// refused it (0x8007139F) next to the main window's. Rust builds it with the main window's string.
test("rows 955/959: the Tower window is opened by Rust with the place the page worked out", async () => {
  const calls: Array<[string, unknown]> = [];
  const invoke = async (cmd: string, args?: Record<string, unknown>) => void calls.push([cmd, args]);
  const legacy = vi.fn(async () => true);
  const second = { url: `index.html${TOWER_HASH}`, title: "Kolux Tower", focus: true, x: -1920, y: 0, width: 1920, height: 1080, maximized: true };
  expect(await createViaRust(invoke, second, legacy)).toBe(true);
  expect(await createViaRust(invoke, { url: "x", center: true, width: 1200, height: 800, maximized: false }, legacy)).toBe(true);
  expect(calls).toEqual([
    ["tower_window_open", { place: { x: -1920, y: 0, width: 1920, height: 1080, center: false, maximized: true } }],
    ["tower_window_open", { place: { width: 1200, height: 800, center: true, maximized: false } }],
  ]);
  expect(legacy).not.toHaveBeenCalled();
});

test("rows 955/959: a refusal from Rust reports failed; only a build without the command falls back to the page's own window", async () => {
  const legacy = vi.fn(async () => true);
  const opts = { center: true, width: 1200, height: 800 };
  expect(await createViaRust(async () => Promise.reject("a webview with the label `tower` already exists"), opts, legacy)).toBe(false);
  expect(legacy).not.toHaveBeenCalled();
  expect(await createViaRust(async () => Promise.reject("Command tower_window_open not found"), opts, legacy)).toBe(true);
  expect(legacy).toHaveBeenCalledTimes(1);
});
