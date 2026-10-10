import { expect, test } from "vitest";
import { defaultAgentId, disabledAgents, menuAgents, offeredAgents, switchAgent } from "./agents";
import type { AgentInfo } from "./PlusMenu";

const mk = (id: string, installed: boolean): AgentInfo => ({ id, name: id, program: id, args: [], installed, path: installed ? `C:\\bin\\${id}.exe` : null });
const list = [mk("claude", true), mk("openclaude", false), mk("codex", true), mk("gemini", false), mk("grok", true)];

test("the menu lists only installed agents, the default first, the rest in catalogue order", () => {
  expect(menuAgents(list, "claude").map((a) => a.id)).toEqual(["claude", "codex", "grok"]);
  expect(menuAgents(list, "grok").map((a) => a.id)).toEqual(["grok", "claude", "codex"]);
  // A default that is not installed (or unknown) does not reorder anything.
  expect(menuAgents(list, "gemini").map((a) => a.id)).toEqual(["claude", "codex", "grok"]);
  expect(menuAgents(list, "nope").map((a) => a.id)).toEqual(["claude", "codex", "grok"]);
  expect(menuAgents([], "claude")).toEqual([]);
});

test("the default agent comes from settings and falls back to Claude Code", () => {
  expect(defaultAgentId({ defaultAgent: "codex" })).toBe("codex");
  expect(defaultAgentId({ defaultAgent: "" })).toBe("");
  expect(defaultAgentId({ defaultAgent: 3 })).toBe("claude");
  expect(defaultAgentId({})).toBe("claude");
  expect(defaultAgentId(null)).toBe("claude");
});

test("switched-off agents are not offered, and switching off the default leaves no default", () => {
  const list = [{ id: "claude" }, { id: "codex" }, { id: "aider" }] as Parameters<typeof offeredAgents>[0];
  expect(offeredAgents(list, { disabledAgents: ["codex", 7] }).map((a) => a.id)).toEqual(["claude", "aider"]);
  expect(offeredAgents(list, {}).length).toBe(3);
  const off = switchAgent({ defaultAgent: "codex" }, "codex", false);
  expect(off).toEqual({ defaultAgent: "", disabledAgents: ["codex"] });
  expect(defaultAgentId(off)).toBe("");
  // switching another one off keeps the default; on again takes it out of the list
  expect(switchAgent({ defaultAgent: "codex" }, "aider", false)).toEqual({ defaultAgent: "codex", disabledAgents: ["aider"] });
  expect(switchAgent(off, "codex", true)).toEqual({ defaultAgent: "", disabledAgents: [] });
  expect(disabledAgents({ disabledAgents: "codex" })).toEqual([]);
});
