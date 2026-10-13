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

export function generate(dir: string, fill: (text: string, dir: string) => void) {
  runs.set(dir, "running");
  bump();
  invoke<string>("scm_commit_message", { worktree: dir })
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
