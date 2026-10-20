// GIT-017: commit-message generations, by worktree. They live outside the Source Control panel, so a
// generation survives switching workspace and the panel being rebuilt, and its answer fills only
// the box of the worktree that began it. A worktree's state is "running", an error to show, or null.
import { invoke } from "@tauri-apps/api/core";

const runs = new Map<string, string>();
const subs = new Set<() => void>();
let version = 0;
const bump = () => {
  version += 1;
  subs.forEach((f) => f());
};

export const genSubscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};
export const genVersion = () => version;
export const genState = (dir: string): string | null => runs.get(dir) ?? null;

/** GIT-018: the settings that say who writes commit messages. */
export const WRITER_KEY = "commitWriter";
export const WRITER_COMMAND_KEY = "commitWriterCommand";
export const WRITER_INSTRUCTIONS_KEY = "commitWriterInstructions";
/** GIT-018 (T-228-d): the model and thinking effort picked for the chosen agent; blank means the agent's own default. */
export const WRITER_MODEL_KEY = "commitWriterModel";
export const WRITER_EFFORT_KEY = "commitWriterEffort";

/** GIT-017 / GIT-018: the agents that can write, in the order they are offered. */
export const WRITER_AGENTS: ReadonlyArray<{ id: string; name: string }> = [
  { id: "claude", name: "Claude Code" },
  { id: "codex", name: "Codex" },
  { id: "amp", name: "Amp" },
  { id: "kimi", name: "Kimi" },
  { id: "copilot", name: "GitHub Copilot" },
  { id: "pi", name: "Pi" },
  { id: "cursor", name: "Cursor" },
  { id: "antigravity", name: "Antigravity" },
];
export const writerName = (id: string) => WRITER_AGENTS.find((a) => a.id === id)?.name ?? id;

export type Writer = {
  /** An agent from the list, a custom command, or nobody. */
  mode: "agent" | "custom" | "off";
  agent: string;
  model: string | null;
  effort: string | null;
  command: string | null;
  instructions: string;
};

export const DEFAULT_WRITER: Writer = { mode: "agent", agent: "claude", model: null, effort: null, command: null, instructions: "" };

/** GIT-018: Claude Code unless the user picked another agent, a custom command (which needs a command) or off. */
export function writerOf(s: Record<string, unknown>): Writer {
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const instructions = text(s[WRITER_INSTRUCTIONS_KEY]);
  if (s[WRITER_KEY] === "off") return { ...DEFAULT_WRITER, mode: "off", instructions };
  if (s[WRITER_KEY] === "custom") {
    const command = text(s[WRITER_COMMAND_KEY]);
    return command ? { ...DEFAULT_WRITER, mode: "custom", command, instructions } : { ...DEFAULT_WRITER, mode: "off", instructions };
  }
  const agent = WRITER_AGENTS.find((a) => a.id === s[WRITER_KEY])?.id ?? "claude";
  return { ...DEFAULT_WRITER, agent, model: text(s[WRITER_MODEL_KEY]) || null, effort: text(s[WRITER_EFFORT_KEY]) || null, instructions };
}

/** The arguments the back end takes to know who writes. */
export const writerArgs = (w: Writer) => (w.mode === "custom" ? { command: w.command } : w.mode === "agent" ? { agent: w.agent, model: w.model, effort: w.effort } : {});

export function generate(dir: string, fill: (text: string, dir: string) => void, writer: Writer = DEFAULT_WRITER) {
  runs.set(dir, "running");
  bump();
  invoke<string>("scm_commit_message", { worktree: dir, command: writer.mode === "custom" ? writer.command : null, instructions: writer.instructions, ...(writer.mode === "agent" ? { agent: writer.agent, model: writer.model, effort: writer.effort } : {}) })
    .then((text) => {
      runs.delete(dir);
      fill(text, dir);
    })
    .catch((e) => {
      if (String(e) === "stopped") runs.delete(dir);
      else runs.set(dir, String(e));
    })
    .finally(bump);
}

export const stopGenerate = (dir: string) => invoke("scm_commit_message_stop", { worktree: dir });

export const dismissGenerate = (dir: string) => {
  runs.delete(dir);
  bump();
};
