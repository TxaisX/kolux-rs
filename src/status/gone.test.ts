import { expect, test } from "vitest";
import { admit, deadKeys, forget, newLedger, noteClosed, retire } from "./gone";
import type { AgentState } from "../projects/rows";

const pane = (key: number, agent = "claude", extra: Record<string, unknown> = {}) => ({ key, agent, ...extra });

test("an agent killed while it shows needs you is retired, its row clears and its resume identity stays (STAT-031)", () => {
  const panes = [pane(1), pane(2), pane(3), pane(4, "shell")];
  const hook: Record<number, AgentState> = { 1: "permission", 2: "working", 3: "waiting", 4: "working" };
  // 1 is dead, 2 is up, 3 is still starting (undefined is not certain), 4 is a shell.
  expect(deadKeys(panes, hook, { 1: false, 2: true, 4: false })).toEqual([1]);
  expect(deadKeys(panes, hook, { 1: false, 3: false })).toEqual([1, 3]);
  const turn = { 1: { tool: "Bash", ask: "Run it?", stop: { cause: "x" } as never, reply: "hi", wrote: "a.ts" }, 2: { tool: "Edit" } };
  const crew = { 1: [{ id: "a", kind: "sub", state: "working" as const }], 2: [] };
  const r = retire([1], hook, turn, crew);
  expect(r.hook).toEqual({ 2: "working", 3: "waiting", 4: "working" });
  expect(r.turn[1]).toEqual({ stop: turn[1].stop, reply: "hi", wrote: "a.ts" }); // the doing clears, the outcome stays
  expect(r.turn[2]).toBe(turn[2]);
  expect(r.crew).toEqual({ 2: [] });
  // Nothing dead: the very same objects, so React does not redraw.
  const same = retire([9], hook, turn, crew);
  expect(same.hook).toBe(hook);
  expect(same.turn).toBe(turn);
  expect(same.crew).toBe(crew);
});

test("a done or idle agent whose program ended is not touched (STAT-031)", () => {
  expect(deadKeys([pane(1), pane(2)], { 1: "done", 2: "idle" }, { 1: false, 2: false })).toEqual([]);
});

test("after a tab closes, a late hook event for it changes nothing and other tabs carry on (STAT-031)", () => {
  const l = newLedger();
  const closed = noteClosed(l, new Set([1, 2, 3]), new Set([1, 3]));
  expect(closed).toEqual([2]);
  expect(admit(l, 2, new Set([1, 3]), { state: "working" })).toBe(false);
  expect(admit(l, 1, new Set([1, 3]), { state: "working" })).toBe(true);
  // Even if a pane with that key were somehow open again, the closed key stays shut until Kolux quits.
  expect(admit(l, 2, new Set([1, 2, 3]), { state: "working" })).toBe(false);
  // A key no pane has is not admitted either (an event before its pane exists is dropped).
  expect(admit(l, 7, new Set([1, 3]), { state: "working" })).toBe(false);
  // The same close seen twice reports nothing new.
  expect(noteClosed(l, new Set([1, 2, 3]), new Set([1, 3]))).toEqual([]);
});

test("a retired pane returns only when a genuine new turn begins (STAT-031)", () => {
  const l = newLedger();
  const open = new Set([5]);
  l.retired.add(5);
  l.running = { 5: false };
  // The old process's late Stop and ask are dropped.
  expect(admit(l, 5, open, { state: "done" })).toBe(false);
  expect(admit(l, 5, open, { state: "waiting" })).toBe(false);
  // A working report while the program is still down is the old process's too.
  expect(admit(l, 5, open, { state: "working" })).toBe(false);
  // The program is up again and reports working: a genuine turn; the pane is no longer retired.
  l.running = { 5: true };
  expect(admit(l, 5, open, { state: "working" })).toBe(true);
  expect(l.retired.has(5)).toBe(false);
  expect(admit(l, 5, open, { state: "done" })).toBe(true);
  // A fresh start is genuine whatever the flags say.
  l.retired.add(5);
  l.running = { 5: false };
  expect(admit(l, 5, open, { state: "idle", fresh: true })).toBe(true);
});

test("a pane closed while retired leaves the retired list (STAT-031)", () => {
  const l = newLedger();
  l.retired.add(1);
  noteClosed(l, new Set([1]), new Set());
  expect(l.retired.has(1)).toBe(false);
  expect(l.closed.has(1)).toBe(true);
});

test("forget drops only the named panes and returns the same object when none is there", () => {
  const r = { 1: "a", 2: "b" };
  expect(forget([2], r)).toEqual({ 1: "a" });
  expect(forget([3], r)).toBe(r);
});
