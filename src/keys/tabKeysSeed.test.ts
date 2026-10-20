// SET-015 (T-246-d): the one-time seed of the old tab-stepping pairing on first load.
import { expect, test } from "vitest";
import { SEEDED_FIELD, seedFirstLoad } from "./tabKeysSeed";

function io(settings: Record<string, unknown> = {}) {
  const writes: Array<[string, string[]]> = [];
  let marked = 0;
  return { writes, marks: () => marked, api: { settings: async () => settings, mark: async () => void marked++, write: async (id: string, c: string[]) => void writes.push([id, c]) } };
}

test("SET-015: an install that already had a file gets the old pairing written once, then the marker", async () => {
  const t = io();
  expect(await seedFirstLoad({ value: { keybindings: {} }, created: false, error: null }, t.api)).toBe(true);
  expect(t.writes.map(([id]) => id).sort()).toEqual(["tab.nextAllTypes", "tab.nextSameType", "tab.previousAllTypes", "tab.previousSameType"]);
  expect(t.writes.find(([id]) => id === "tab.nextSameType")![1]).toEqual(["Mod+Shift+BracketRight"]);
  expect(t.marks()).toBe(1);
});

test("SET-015: a new install (file just created) writes nothing and is marked", async () => {
  const t = io();
  expect(await seedFirstLoad({ value: {}, created: true, error: null }, t.api)).toBe(false);
  expect(t.writes).toEqual([]);
  expect(t.marks()).toBe(1);
});

test("SET-015: once marked it never runs again, and a file that names the commands is left alone", async () => {
  const done = io({ [SEEDED_FIELD]: true });
  expect(await seedFirstLoad({ value: { keybindings: {} }, created: false, error: null }, done.api)).toBe(false);
  expect(done.writes).toEqual([]);
  expect(done.marks()).toBe(0);
  const named = io();
  expect(await seedFirstLoad({ value: { keybindings: { "tab.nextAllTypes": "Mod+J" } }, created: false, error: null }, named.api)).toBe(false);
  expect(named.writes).toEqual([]);
});

test("SET-015: an unreadable file is retried at the next start, not marked", async () => {
  const t = io();
  expect(await seedFirstLoad({ value: null, created: false, error: "bad json" }, t.api)).toBe(false);
  expect(t.marks()).toBe(0);
});
