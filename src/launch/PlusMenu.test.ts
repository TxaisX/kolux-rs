// The plus menu rendered to HTML with no browser: only installed agents are offered, the default
// comes first with its shortcut when one is bound, the others get a "default" button.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { KeymapContext } from "../keys/KeymapContext";
import { resolve } from "../keys/keymap";
import PlusMenu, { markFor, programWord, shellWord, type AgentInfo } from "./PlusMenu";

const claude: AgentInfo = { id: "claude", name: "Claude Code", program: "claude", args: ["--permission-mode", "auto"], installed: true, path: "C:\\Users\\me\\.local\\bin\\claude.exe" };
const codex: AgentInfo = { id: "codex", name: "Codex", program: "codex", args: ["--dangerously-bypass-approvals-and-sandbox"], installed: true, path: "C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd" };
const gemini: AgentInfo = { id: "gemini", name: "Gemini CLI", program: "gemini", args: [], installed: false, path: null };

function items(html: string): string[] {
  return html.split("</button>").filter((chunk) => chunk.includes('role="menuitem"'));
}

const render = (props: Partial<Parameters<typeof PlusMenu>[0]>, keybindings: Record<string, string[]> = {}) => {
  const map = resolve({ keybindings }, "win32");
  const el = createElement(PlusMenu, { agents: [claude, codex, gemini], onPick: () => {}, onClose: () => {}, ...props });
  return renderToString(createElement(KeymapContext.Provider, { value: { ...map, path: null, reload: () => {} } }, el));
};

test("only installed agents are offered, the default first, and a missing one is not listed", () => {
  const html = render({});
  expect(html).toContain('role="menu"');
  const rows = items(html);
  const claudeRow = rows.find((r) => r.includes("Claude Code"));
  const codexRow = rows.find((r) => r.includes("Codex"));
  expect(claudeRow).toBeDefined();
  expect(codexRow).toBeDefined();
  expect(claudeRow).not.toContain("disabled");
  expect(claudeRow).toContain('alt="Claude"');
  expect(html).not.toContain("Gemini");
  expect(html).not.toContain("not installed");
  expect(rows.indexOf(claudeRow!)).toBeLessThan(rows.indexOf(codexRow!));
});

test("making Codex the default moves it to the top with the shortcut, and the others offer 'default'", () => {
  const html = render({ defaultId: "codex", onSetDefault: () => {} }, { "tab.newAgent": ["Ctrl+Alt+T"] });
  const rows = items(html);
  expect(rows[0]).toContain("Codex");
  expect(rows[0]).toContain('class="kbd"');
  expect(rows[0]).toContain("Ctrl");
  const claudeRow = rows.find((r) => r.includes("Claude Code"))!;
  expect(claudeRow).not.toContain('class="kbd"');
  // The "default" button sits beside Claude's row, never beside the default agent's own row.
  expect(html).toContain('title="Make Claude Code the default agent"');
  expect(html).not.toContain("Make Codex the default agent");
});

test("an unbound shortcut draws no chip, a launch in flight greys the rows, an empty catalogue says it is looking", () => {
  const unbound = render({ defaultId: "claude" });
  expect(unbound).not.toContain('class="kbd"');
  expect(unbound).not.toContain("Unassigned");
  const busy = render({ busy: true });
  expect(items(busy).find((r) => r.includes("Claude Code"))).toContain('disabled=""');
  const empty = render({ agents: [] });
  expect(empty).toContain("Looking for agents");
  const none = render({ agents: [gemini] });
  expect(none).toContain("No agent found");
  expect(none).toContain("gemini");
});

test("agent ids map to vendor marks and header words", () => {
  expect(markFor("claude")).toBe("claude");
  expect(markFor("codex")).toBe("codex");
  expect(markFor("anything-else")).toBe("shell");
  expect(programWord("claude")).toBe("Claude");
  expect(programWord("codex")).toBe("Codex");
  expect(programWord("shell")).toBe("PowerShell");
  // ACCT-046: an automatic pane is named for the shell that started, fallbacks included.
  expect(shellWord("C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")).toBe("Windows PowerShell");
  expect(shellWord("C:/Program Files/PowerShell/7/pwsh.exe")).toBe("PowerShell 7");
  expect(shellWord("C:\\WINDOWS\\system32\\cmd.exe")).toBe("Command Prompt");
  expect(shellWord("/bin/zsh")).toBe("zsh");
});

test("SESS-007: the chooser item appears only when a handler is given", () => {
  expect(render({ onChoose: () => {} })).toContain("Choose what to run…");
  expect(render({})).not.toContain("Choose what to run…");
});

test("SESS-003 / SESS-010 / SESS-002: the default row is marked, all-off and errored searches say so", () => {
  const html = render({ defaultId: "codex", onSetDefault: () => {} });
  const rows = html.split('class="menu-row"');
  expect(rows.find((r) => r.includes("Codex"))).toContain("Default</span>");
  expect(rows.find((r) => r.includes("Claude Code"))).toContain("Set as default");
  expect(rows.find((r) => r.includes("Codex"))).not.toContain("Set as default");
  expect(html).toContain("Hide agents…");
  // With no default the list keeps catalogue order and nothing is marked.
  expect(render({ defaultId: "" })).not.toContain("Default</span>");
  // Every installed agent switched off: an empty-state line and a way to agent settings.
  const off = render({ agents: [{ ...gemini }], allOff: true, pass: { looking: false, done: true, error: null } });
  expect(off).toContain("No agent is switched on");
  expect(items(off).some((r) => r.includes("Agent settings…"))).toBe(true);
  expect(off).not.toContain("No agent found");
  // An errored search looks different from one that found nothing, and blocks the rows.
  const failed = render({ pass: { looking: false, done: true, error: "IPC down" }, onRefresh: () => {} });
  expect(failed.replace(/<!-- -->/g, "")).toContain("could not look for agents (IPC down)");
  expect(items(failed).find((r) => r.includes("Claude Code"))).toContain('disabled=""');
  expect(items(failed).some((r) => r.includes("Refresh agents"))).toBe(true);
  const first = render({ agents: [claude], pass: { looking: true, done: false, error: null } });
  expect(first).toContain("Looking for agents");
  expect(first).not.toContain("No agent found");
});
