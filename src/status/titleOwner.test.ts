import { expect, test } from "vitest";
import { titleOwner } from "./titleOwner";

const who = (t: string) => {
  const o = titleOwner(t);
  return o.unknown ? "unknown" : [...o.owners].sort().join(",");
};

test("a name counts only in a fixed place: the title's first words or its last part (STAT-033)", () => {
  expect(who("Claude Code")).toBe("claude");
  expect(who("codex – working")).toBe("codex");
  expect(who("working - Codex")).toBe("codex");
  expect(who("⠋ Cursor Agent")).toBe("cursor");
  expect(who("MiMo Code - fixing tests")).toBe("mimo-code");
  expect(who("pi ⠙ working")).toBe("omp,pi");
  expect(who("oh-my-pi")).toBe("omp");
});

test("a name inside the task text, a worktree name or a model name alone never decides (STAT-033)", () => {
  // Claude Code's own star marks the title as Claude's even when the task mentions Codex.
  expect(who("✳ Fix the codex login bug")).toBe("claude");
  expect(who("Claude Code - port the codex importer")).toBe("claude");
  expect(who("refactor the claude adapter")).toBe("");
  expect(who("kolux-codex-wt ⠋")).toBe("");
  expect(who("codex-tests")).toBe("");
  expect(who("Claude Sonnet 4.5 ⠋ working")).toBe("");
  expect(who("Claude 3.7")).toBe("");
  expect(who("gpt-5-codex")).toBe("");
  expect(who("user@host: ~/codexes")).toBe("");
  expect(who("C:\\repo\\claude")).toBe("");
});

test("conflicting marks give unknown, and the order of title parts never decides (STAT-033)", () => {
  expect(who("Claude - Codex")).toBe("unknown");
  expect(who("Codex - Claude")).toBe("unknown");
  expect(who("✳ Codex")).toBe("unknown");
  expect(who("π - Claude Code")).toBe("unknown");
  // Marks that agree are one owner; the pi sign alone fits both Pi-style agents.
  expect(who("✳ Claude Code")).toBe("claude");
  expect(who("π - kolux-rs")).toBe("omp,pi");
  expect(who("π - OMP")).toBe("omp");
});
