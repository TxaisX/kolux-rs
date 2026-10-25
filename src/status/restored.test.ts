import { expect, test } from "vitest";
import { restoration, shownState, RESTART_TEXT, type SavedRow } from "./restored";

const row = (paneKey: number, state: string, extra: Partial<SavedRow> = {}): SavedRow => ({ paneKey, agent: "claude", state, at: 1, unconfirmed: true, restart: false, ...extra });

test("a restored row shows on a loaded pane with no live reading, marked stale until an event confirms it (STAT-030)", () => {
  const r = restoration([row(1, "working"), row(2, "done"), row(3, "waiting"), row(4, "working")], new Set([1, 2, 3]), new Set([3]));
  expect(r.hook).toEqual({ 1: "working", 2: "done" });
  expect(r.stale).toEqual({ 1: true, 2: true });
});

test("a restored permission shows as waiting and names no tool, so it cannot drive approve", () => {
  const r = restoration([row(1, "permission")], new Set([1]), new Set());
  expect(r.hook[1]).toBe("waiting");
  expect(r.turn[1]).toBeUndefined();
  expect(shownState("permission")).toBe("waiting");
  expect(shownState("not-a-state")).toBeNull();
});

test("kept child rows come back with the pane; a row no longer unconfirmed is skipped", () => {
  const children = [{ id: "a", kind: "worker", state: "working" as const }];
  const r = restoration([row(1, "working", { children }), row(2, "working", { unconfirmed: false })], new Set([1, 2]), new Set());
  expect(r.crew).toEqual({ 1: children });
  expect(r.hook[2]).toBeUndefined();
});

test("a pane whose hooks are from an older Kolux gets a blocked row asking to restart the terminal", () => {
  const r = restoration([row(1, "working", { restart: true })], new Set([1]), new Set());
  expect(r.hook[1]).toBe("blocked");
  expect(r.turn[1].stop.detail).toBe(RESTART_TEXT);
});
