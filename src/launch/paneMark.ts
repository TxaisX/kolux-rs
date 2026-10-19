// FIX-3: the vendor mark a pane carries, decided by ONE rule that the Rust side shares.
// Rust credits a pane's program with agents::credited_agent (it reads the program as a command
// line: a quoted first word, else the text up to the first space; the file's stem with folder, case
// and program/script endings dropped; an interpreter such as node is credited by its entry script).
// creditedAgent below is that function, and paneMark.test.ts reads agents.rs and runs every
// credited_agent case that file asserts, and compares the program-name table, so the two cannot
// drift apart without a red test. When the Rust rule changes (the review of b26fdad3 asks for a
// path with spaces to be credited), change this in the same commit.
import type { Agent } from "../chrome/VendorMark";

/** The catalogue ids and the program names Rust credits them by (agents.rs CATALOGUE, same order: the first match wins). */
export const CREDIT_NAMES: readonly (readonly [string, readonly string[]])[] = [
  ["claude", ["claude"]],
  ["openclaude", ["openclaude"]],
  ["codex", ["codex"]],
  ["autohand", ["autohand"]],
  ["ante", ["ante"]],
  ["trae", ["traecli"]],
  ["mimo-code", ["mimo"]],
  ["pi", ["pi"]],
  ["omp", ["omp"]],
  ["prime-agent", ["prime-agent"]],
  ["gemini", ["gemini"]],
  ["antigravity", ["agy"]],
  ["aider", ["aider"]],
  ["goose", ["goose"]],
  ["amp", ["amp"]],
  ["kilo", ["kilo"]],
  ["kiro", ["kiro-cli"]],
  ["crush", ["crush"]],
  ["aug", ["auggie"]],
  ["cline", ["cline"]],
  ["codebuff", ["codebuff"]],
  ["command-code", ["command-code"]],
  ["continue", ["cn"]],
  ["cursor", ["cursor-agent"]],
  ["droid", ["droid"]],
  ["kimi", ["kimi", "kimi-code"]],
  ["mistral-vibe", ["vibe", "mistral-vibe"]],
  ["qwen-code", ["qwen"]],
  ["rovo", ["rovo"]],
  ["hermes", ["hermes"]],
  ["openclaw", ["openclaw"]],
  ["copilot", ["copilot"]],
  ["grok", ["grok"]],
  ["devin", ["devin"]],
];

const INTERPRETERS = ["node", "bun", "deno", "python", "python3", "pwsh"];
const ENDINGS = [".exe", ".cmd", ".bat", ".com", ".ps1", ".js", ".mjs", ".cjs", ".py"];

/** The bare lower-case name of a program word: no folder, no quotes, no program/script ending. */
function programStem(word: string): string {
  const base = (word.replace(/^"+|"+$/g, "").split(/[\\/]/).pop() ?? "").toLowerCase();
  const ext = ENDINGS.find((e) => base.endsWith(e));
  return ext ? base.slice(0, -ext.length) : base;
}

/** The catalogue id whose program names cover `stem`; with `packages`, `<name>-...` counts for every agent (an entry script's package folder), else only for Codex and Grok builds. */
function creditedName(stem: string, packages: boolean): string | null {
  if (!stem) return null;
  for (const [id, names] of CREDIT_NAMES) {
    const dashed = packages || id === "codex" || id === "grok";
    if (names.some((n) => n === stem || (dashed && stem.startsWith(`${n}-`)))) return id;
  }
  return null;
}

/** agents::credited_agent in TypeScript: which catalogue agent a program (read as a command line) runs, or null. */
export function creditedAgent(commandLine: string): string | null {
  const line = commandLine.replace(/^\s+/, "");
  let first: string;
  let rest: string;
  const quoted = line.startsWith('"') ? line.slice(1).indexOf('"') : -1;
  if (quoted >= 0) {
    first = line.slice(1, 1 + quoted);
    rest = line.slice(quoted + 2);
  } else {
    const at = line.search(/\s/);
    first = at < 0 ? line : line.slice(0, at);
    rest = at < 0 ? "" : line.slice(at + 1);
  }
  if (!first) return null;
  const name = programStem(first);
  const own = creditedName(name, false);
  if (own) return own;
  if (!INTERPRETERS.includes(name)) return null;
  for (const word of rest.split(/\s+/).filter(Boolean)) {
    for (const part of word.split(/[\\/]/)) {
      const id = creditedName(programStem(part), true);
      if (id) return id;
    }
  }
  return null;
}

/** The mark a program earns: Claude or Codex when Rust would credit it to that agent, else the plain shell. */
export function programMark(program: string | null | undefined): Agent {
  const id = creditedAgent(program ?? "");
  return id === "claude" || id === "codex" ? id : "shell";
}

/**
 * Which vendor mark an agent draws. The built-in ids keep their marks; any other id (OpenClaude,
 * Gemini...) takes the mark of the program it runs, so one whose Settings > Agents Command names
 * Claude or Codex is a Claude or Codex pane (FIX-2). Without a program, or for any other program,
 * it is the plain-shell glyph.
 */
export function markFor(id: string, program?: string | null): Agent {
  if (id === "claude-agent-teams") return "claude";
  if (id === "claude" || id === "codex") return id;
  return programMark(program);
}

/**
 * The mark for a pane the app is about to build. The start line's program is the Command the user
 * set in Settings > Agents (else the catalogue program), so it wins over the catalogue's own; the
 * catalogue program alone would never show a Command override. Every site that builds a pane from
 * an agent and its start line uses this one helper.
 */
export function paneMark(agent: { id: string; program: string }, line: { program?: string | null }): Agent {
  return markFor(agent.id, line.program ?? agent.program);
}
