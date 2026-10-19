// FIX-3: the pane mark, with real catalogue ids and real program paths, and the one credit rule shared with Rust.
import { expect, test } from "vitest";
import { hooksAbsent } from "../chat/kitPrompt";
import { CREDIT_NAMES, creditedAgent, markFor, paneMark, programMark } from "./paneMark";
import { markFor as markForViaMenu } from "./PlusMenu";
import rustSource from "../../src-tauri/src/agents.rs?raw";
import appSource from "../App.tsx?raw";

const rust = rustSource.replace(/\r/g, "");

test("FIX-3: the real catalogue ids take the mark of the program their Command names", () => {
  // OpenClaude, Gemini and the rest never have a custom id: the Command field is the only route.
  expect(markFor("openclaude", "C:\\tools\\claude.exe")).toBe("claude");
  expect(markFor("openclaude", "claude")).toBe("claude");
  expect(markFor("openclaude", "C:\\Users\\me\\AppData\\Roaming\\npm\\Claude.CMD")).toBe("claude");
  expect(markFor("gemini", "/usr/local/bin/codex")).toBe("codex");
  expect(markFor("aider", "codex.exe")).toBe("codex");
  expect(markFor("gemini", "C:\\tools\\codex-nightly.exe")).toBe("codex");
  // Their own programs stay the plain shell glyph, and so does a Command that is not Claude or Codex.
  expect(markFor("openclaude", "openclaude")).toBe("shell");
  expect(markFor("gemini", "gemini")).toBe("shell");
  expect(markFor("gemini", "pwsh")).toBe("shell");
  expect(markFor("gemini", null)).toBe("shell");
  expect(markFor("gemini")).toBe("shell");
  // Built-in ids keep their marks whatever program is passed; the menu re-exports the same function.
  expect(markFor("claude", "pwsh")).toBe("claude");
  expect(markFor("codex", "claude")).toBe("codex");
  expect(markFor("claude-agent-teams", "x")).toBe("claude");
  expect(markForViaMenu).toBe(markFor);
});

test("FIX-3: a program is read as a command line, the way Rust credits it", () => {
  expect(markFor("openclaude", "claude --x")).toBe("claude");
  expect(markFor("openclaude", "claude.exe --permission-mode auto")).toBe("claude");
  expect(markFor("openclaude", "  codex   --sandbox x")).toBe("codex");
  expect(markFor("openclaude", '"C:\\Program Files\\Claude\\claude.exe" --x')).toBe("claude");
  expect(markFor("openclaude", '"claude"')).toBe("claude");
  expect(markFor("gemini", "node C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js")).toBe("claude");
  expect(markFor("gemini", "node /usr/lib/node_modules/@openai/codex/bin/codex.js")).toBe("codex");
  // Same as Rust: an unquoted path with a space is cut at the space ("C:\Program" is not an agent).
  expect(markFor("openclaude", "C:\\Program Files\\Claude\\claude.exe")).toBe("shell");
  // Look-alikes and other agents stay shell.
  expect(markFor("gemini", "claude-helper")).toBe("shell");
  expect(markFor("gemini", "claude-teams")).toBe("shell");
  expect(markFor("gemini", "notclaude.exe")).toBe("shell");
  expect(markFor("gemini", "C:\\claude\\run.exe")).toBe("shell");
  expect(markFor("gemini", "node build.js")).toBe("shell");
  expect(markFor("gemini", "python -m aider --model x")).toBe("shell");
  expect(programMark("")).toBe("shell");
  expect(programMark(undefined)).toBe("shell");
});

test("FIX-3: a Command that names Claude counts as hooked in the chat notice; Codex and a shell do not", () => {
  expect(hooksAbsent(markFor("openclaude", "claude"), true, "openclaude")).toBe(false);
  expect(hooksAbsent(markFor("openclaude", "claude"), false, "openclaude")).toBe(true);
  expect(hooksAbsent(markFor("openclaude", "codex"), true, "openclaude")).toBe(true);
  expect(hooksAbsent(markFor("openclaude", "pwsh"), true, "openclaude")).toBe(true);
  expect(hooksAbsent(markFor("openclaude", "openclaude"), true, "openclaude")).toBe(true);
});

test("FIX-3: paneMark, the helper every pane-building site uses, follows the start line before the catalogue", () => {
  const openclaude = { id: "openclaude", program: "openclaude" };
  // The start line carries the Command the user set; the catalogue program alone would lose it.
  expect(paneMark(openclaude, { program: "C:\\tools\\claude.exe" })).toBe("claude");
  expect(paneMark(openclaude, { program: "codex" })).toBe("codex");
  expect(paneMark(openclaude, { program: "claude --x" })).toBe("claude");
  // No program on the line: the catalogue's own.
  expect(paneMark(openclaude, { program: null })).toBe("shell");
  expect(paneMark(openclaude, {})).toBe("shell");
  expect(paneMark({ id: "claude", program: "claude" }, { program: null })).toBe("claude");
  expect(paneMark({ id: "codex", program: "codex" }, { program: "pwsh" })).toBe("codex");
  expect(paneMark({ id: "gemini", program: "gemini" }, { program: "pwsh" })).toBe("shell");
});

test("FIX-3: App.tsx builds every pane mark from the start line's program", () => {
  const app = appSource.replace(/\r/g, "");
  const calls = [...app.matchAll(/\b(?:markFor|paneMark)\(([^()]*)\)/g)].map((m) => m[0]).filter((c) => /\b(?:a|agent)\b/.test(c));
  expect(calls.length).toBeGreaterThanOrEqual(3);
  // Swapping the line's program for the catalogue's (a.program) would lose the whole feature.
  for (const c of calls) {
    expect(c, "a pane built from an agent uses its start line").toContain("line");
  }
});

test("FIX-3: creditedAgent runs every case agents.rs asserts for credited_agent", () => {
  const cases = [...rust.matchAll(/assert_eq!\(credited_agent\((r#"(.*?)"#|r"(.*?)"|"(.*?)")\), (None|Some\("(.*?)"\))/g)];
  expect(cases.length).toBeGreaterThanOrEqual(16);
  for (const m of cases) {
    const input = m[2] ?? m[3] ?? m[4] ?? "";
    const want = m[6] ?? null;
    expect(creditedAgent(input), `credited_agent(${JSON.stringify(input)})`).toBe(want);
  }
});

test("FIX-3: the program-name table matches the catalogue in agents.rs, in order", () => {
  const body = rust.slice(rust.indexOf("pub const CATALOGUE"), rust.indexOf("/// The catalogue with each agent"));
  const rows = [...body.matchAll(/^\s*\("([a-z-]+)", "[^"]*", &\[([^\]]*)\]/gm)].map((m) => [m[1], [...m[2].matchAll(/"([^"]+)"/g)].map((n) => n[1])]);
  expect(rows.length).toBe(34);
  expect(CREDIT_NAMES.map(([id, names]) => [id, [...names]])).toEqual(rows);
});
