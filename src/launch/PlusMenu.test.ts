// The plus menu rendered to HTML with no browser: an installed agent can be chosen, a missing one
// is greyed and says so, the default agent comes first.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import PlusMenu, { markFor, programWord, type AgentInfo } from "./PlusMenu";

const claude: AgentInfo = { id: "claude", name: "Claude Code", program: "claude", args: ["--permission-mode", "auto"], installed: true, path: "C:\\Users\\me\\.local\\bin\\claude.exe" };
const codex: AgentInfo = { id: "codex", name: "Codex", program: "codex", args: ["--dangerously-bypass-approvals-and-sandbox"], installed: false, path: null };

function items(html: string): string[] {
  return html.split("</button>").filter((chunk) => chunk.includes('role="menuitem"'));
}

test("an installed agent can be chosen and a missing one is greyed with 'not installed'", () => {
  const html = renderToString(createElement(PlusMenu, { agents: [claude, codex], onPick: () => {}, onClose: () => {} }));
  expect(html).toContain('role="menu"');
  const rows = items(html);
  const claudeRow = rows.find((r) => r.includes("Claude Code"));
  const codexRow = rows.find((r) => r.includes("Codex"));
  expect(claudeRow).toBeDefined();
  expect(codexRow).toBeDefined();
  expect(claudeRow).not.toContain("disabled");
  expect(claudeRow).not.toContain("not installed");
  expect(claudeRow).toContain('alt="Claude"');
  expect(codexRow).toContain('disabled=""');
  expect(codexRow).toContain("not installed");
  expect(codexRow).toContain("was not found on the PATH");
  expect(rows.indexOf(claudeRow!)).toBeLessThan(rows.indexOf(codexRow!));
});

test("while a launch is in flight every agent is greyed, and an empty list says it is still looking", () => {
  const busy = renderToString(createElement(PlusMenu, { agents: [claude], onPick: () => {}, onClose: () => {}, busy: true }));
  expect(items(busy).find((r) => r.includes("Claude Code"))).toContain('disabled=""');
  const empty = renderToString(createElement(PlusMenu, { agents: [], onPick: () => {}, onClose: () => {} }));
  expect(empty).toContain("Looking for agents");
});

test("agent ids map to vendor marks and header words", () => {
  expect(markFor("claude")).toBe("claude");
  expect(markFor("codex")).toBe("codex");
  expect(markFor("anything-else")).toBe("shell");
  expect(programWord("claude")).toBe("Claude");
  expect(programWord("codex")).toBe("Codex");
  expect(programWord("shell")).toBe("PowerShell");
});
