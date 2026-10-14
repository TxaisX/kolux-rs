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
export type Writer = { mode: "claude" | "custom" | "off"; command: string | null; instructions: string };

/** GIT-018: Claude Code unless the user picked a custom command (which needs a command) or off. */
export function writerOf(s: Record<string, unknown>): Writer {
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const instructions = text(s[WRITER_INSTRUCTIONS_KEY]);
  if (s[WRITER_KEY] === "off") return { mode: "off", command: null, instructions };
  if (s[WRITER_KEY] === "custom") {
    const command = text(s[WRITER_COMMAND_KEY]);
    return command ? { mode: "custom", command, instructions } : { mode: "off", command: null, instructions };
  }
  return { mode: "claude", command: null, instructions };
}

export function generate(dir: string, fill: (text: string, dir: string) => void, writer: Writer = { mode: "claude", command: null, instructions: "" }) {
  runs.set(dir, "running");
  bump();
  invoke<string>("scm_commit_message", { worktree: dir, command: writer.command, instructions: writer.instructions })
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
