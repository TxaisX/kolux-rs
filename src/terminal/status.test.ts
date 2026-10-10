import { expect, test } from "vitest";
import { ageLabel, headerOf, nextNeedsYou } from "./status";

test("a plain shell reads as a terminal with a neutral status; an agent's word is tinted (TERM-020, TERM-021)", () => {
  expect(headerOf("shell", "running", undefined, false, null, 0)).toMatchObject({ word: "Ready", tone: "", needsYou: false });
  expect(headerOf("shell", "ended", 0, false, 0, 0)).toMatchObject({ word: "Ended", tone: "" });
  expect(headerOf("claude", "running", undefined, false, null, 0)).toMatchObject({ word: "Working", tone: "working", needsYou: false });
  expect(headerOf("claude", "running", undefined, true, null, 0)).toMatchObject({ word: "Needs you", tone: "attention", needsYou: true });
  expect(headerOf("claude", "ended", 0, false, 0, 0)).toMatchObject({ word: "Done", tone: "done", icon: "done" });
  expect(headerOf("claude", "ended", 2, false, 0, 0)).toMatchObject({ word: "Ended (2)", tone: "" });
  expect(headerOf("claude", "failed", undefined, false, null, 0)).toMatchObject({ word: "Failed", tone: "attention", needsYou: true });
});

test("a finished agent shows how long ago: just now, then minutes (TERM-023)", () => {
  const t = 1_000_000;
  expect(ageLabel(t, t + 59_000)).toBe("just now");
  expect(ageLabel(t, t + 60_000)).toBe("1m ago");
  expect(ageLabel(t, t + 3 * 60_000 + 20_000)).toBe("3m ago");
  expect(headerOf("claude", "ended", 0, false, t, t + 180_000).age).toBe("3m ago");
});

test("the shortcut cycles through every pane that needs you and stays put with none (TERM-030)", () => {
  const needs = new Set([1, 3]);
  expect(nextNeedsYou([1, 2, 3], needs, 1)).toBe(3);
  expect(nextNeedsYou([1, 2, 3], needs, 3)).toBe(1);
  expect(nextNeedsYou([1, 2, 3], needs, 2)).toBe(3);
  expect(nextNeedsYou([1, 2, 3], new Set([2]), 2)).toBe(2);
  expect(nextNeedsYou([1, 2, 3], new Set(), 2)).toBeNull();
});

test("the hooks feed the header while the program still runs: needs you, blocked, interrupted, done with its age (STAT-001, STAT-007)", () => {
  expect(headerOf("claude", "running", undefined, false, null, 0, "permission")).toMatchObject({ word: "Needs you", tone: "attention", needsYou: true });
  expect(headerOf("claude", "running", undefined, false, null, 0, "waiting")).toMatchObject({ word: "Needs you", needsYou: true });
  expect(headerOf("claude", "running", undefined, false, null, 0, "blocked")).toMatchObject({ word: "Blocked", tone: "attention", needsYou: true });
  expect(headerOf("claude", "running", undefined, false, null, 0, "interrupted")).toMatchObject({ word: "Interrupted", tone: "attention", needsYou: true });
  expect(headerOf("claude", "running", undefined, false, 0, 30000, "done")).toMatchObject({ word: "Done", tone: "done", needsYou: false, age: "just now" });
  expect(headerOf("claude", "running", undefined, false, null, 0, "working")).toMatchObject({ word: "Working", tone: "working", needsYou: false });
  // The hook never speaks for a shell and never changes an ended program.
  expect(headerOf("shell", "running", undefined, false, null, 0, "permission")).toMatchObject({ word: "Ready", needsYou: false });
  expect(headerOf("claude", "ended", 0, false, 0, 0, "permission")).toMatchObject({ word: "Done", needsYou: false });
});
