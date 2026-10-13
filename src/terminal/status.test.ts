import { expect, test } from "vitest";
import { VOCAB, ageLabel, branchChip, headerOf, nextNeedsYou, crewLabel, crewLine, stoppedLabel, type Crew, type StatusKey } from "./status";

test("a plain shell reads as a terminal with a neutral status; an agent's word is tinted (TERM-020, TERM-021)", () => {
  expect(headerOf("shell", "running", undefined, false, null, 0)).toMatchObject({ word: "Ready", tone: "", needsYou: false });
  expect(headerOf("shell", "ended", 0, false, 0, 0)).toMatchObject({ word: "Ended", tone: "" });
  expect(headerOf("claude", "running", undefined, false, null, 0)).toMatchObject({ word: "Working", tone: "working", needsYou: false });
  expect(headerOf("claude", "running", undefined, true, null, 0)).toMatchObject({ word: "Needs you", tone: "attention", needsYou: true });
  expect(headerOf("claude", "ended", 0, false, 0, 0)).toMatchObject({ word: "Done", tone: "done", glyph: "check", state: "done" });
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

test("the roster label counts agents and those waiting on the user; a line names role, model and state (STAT-026)", () => {
  const crew: Crew = [
    { id: "a1", kind: "code-reviewer", model: "opus", state: "permission" },
    { id: "a2", kind: "tester", state: "working" },
  ];
  expect(crewLabel(crew)).toBe("2 agents, 1 waiting");
  expect(crewLabel(crew.slice(1))).toBe("1 agent");
  expect(crewLine(crew[0])).toBe("code-reviewer (opus) · needs you");
  expect(crewLine(crew[1])).toBe("tester · working");
});

test("every surface reads one vocabulary: each state has its word, glyph, tone and hover explanation (STAT-052)", () => {
  const keys = Object.keys(VOCAB) as StatusKey[];
  for (const k of keys) {
    const v = VOCAB[k];
    expect(v.word, k).not.toBe("");
    expect(v.explain, k).toMatch(/[.!]$/);
  }
  // The card's own ten states are all there, each with its own glyph: working spins, done is a check.
  expect(keys).toEqual(expect.arrayContaining(["working", "background", "blocked", "waiting", "permission", "interrupted", "failed", "done", "idle", "stale"]));
  expect(VOCAB.working.glyph).toBe("spinner");
  expect(VOCAB.done.glyph).toBe("check");
  // Blocked and waiting borrow the permission look; the Agents view's starting and cannot-reach labels are words of their own.
  expect([VOCAB.blocked.glyph, VOCAB.waiting.glyph]).toEqual([VOCAB.permission.glyph, VOCAB.permission.glyph]);
  expect([VOCAB.blocked.tone, VOCAB.waiting.tone]).toEqual([VOCAB.permission.tone, VOCAB.permission.tone]);
  expect(VOCAB.starting.word).toBe("Starting");
  expect(VOCAB.unreachable.word).toBe("Cannot reach");
  expect(stoppedLabel("exit code 2")).toBe("Stopped: exit code 2");
});

test("the pane header is the vocabulary applied to what the pane knows: hook states map to keys, a shell keeps its own words (STAT-052, TERM-020)", () => {
  const h = (hook?: Parameters<typeof headerOf>[6], needs = false) => headerOf("claude", "running", undefined, needs, null, 0, hook);
  expect(h("working")).toMatchObject({ state: "working", glyph: "spinner", explain: VOCAB.working.explain });
  expect(h("permission")).toMatchObject({ state: "permission", glyph: VOCAB.permission.glyph, word: "Needs you", needsYou: true });
  expect(h("waiting")).toMatchObject({ state: "waiting", word: "Needs you", needsYou: true, explain: VOCAB.waiting.explain });
  expect(h(undefined, true)).toMatchObject({ state: "permission" });
  expect(h("blocked")).toMatchObject({ state: "blocked", word: "Blocked", needsYou: true });
  expect(h("interrupted")).toMatchObject({ state: "interrupted", glyph: "interrupted", needsYou: true });
  expect(h("done")).toMatchObject({ state: "done", glyph: "check", tone: "done" });
  expect(headerOf("claude", "starting", undefined, false, null, 0)).toMatchObject({ state: "starting", glyph: "spinner", word: "Starting" });
  expect(headerOf("claude", "failed", undefined, false, null, 0)).toMatchObject({ state: "failed", glyph: "failed" });
  expect(headerOf("shell", "running", undefined, false, null, 0)).toMatchObject({ state: "idle", word: "Ready", glyph: "idle" });
  expect(headerOf("shell", "ended", 2, false, 0, 0)).toMatchObject({ state: "stopped", word: "Ended (2)", explain: "Stopped: exit code 2" });
});

test("TERM-022: the chip names the branch, a detached HEAD shows its short commit, a plain folder shows none", () => {
  expect(branchChip({ branch: "feature/x", head: "0123456789abcdef0123456789abcdef01234567" })).toEqual({ text: "feature/x", tip: "feature/x" });
  expect(branchChip({ branch: null, head: "0123456789abcdef0123456789abcdef01234567" })).toEqual({ text: "0123456", tip: "Detached at 0123456789abcdef0123456789abcdef01234567" });
  expect(branchChip(null)).toBeNull();
  expect(branchChip({ branch: null, head: null })).toBeNull();
});
