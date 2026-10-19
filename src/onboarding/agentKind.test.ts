// FIX-5: the one rule for "this id is an AI agent, not a plain terminal", shared by the guide and the first folder.
import { expect, test } from "vitest";
import { isAiAgent } from "./agentKind";

test("blank, whitespace and the plain terminal are not AI agents, in any spelling", () => {
  for (const v of [undefined, null, "", "   ", "terminal", "Terminal", " TERMINAL ", "\tterminal\n"]) expect(isAiAgent(v)).toBe(false);
});

test("any other id is an AI agent", () => {
  for (const v of ["claude", "codex", "grok", " claude ", "terminal-2", "my-terminal"]) expect(isAiAgent(v)).toBe(true);
});
