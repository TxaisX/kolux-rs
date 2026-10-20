// GIT-020 (T-228-d): a workspace that starts with a placeholder branch gets a branch named after
// its first task. On by default; a profile that predates the setting counts as on until the user
// switches it off once (the switch writes both keys), and an opt-out after that is respected.
import { invoke } from "@tauri-apps/api/core";
import { writerArgs, writerOf } from "./generate";

export const AUTO_BRANCH_KEY = "autoBranchName";
export const AUTO_BRANCH_SEEN_KEY = "autoBranchChosen";

export const autoBranchOn = (s: Record<string, unknown>): boolean => s[AUTO_BRANCH_SEEN_KEY] !== true || s[AUTO_BRANCH_KEY] !== false;
/** The settings patch for the switch: always records that the user has chosen. */
export const autoBranchPatch = (on: boolean): Record<string, unknown> => ({ [AUTO_BRANCH_KEY]: on, [AUTO_BRANCH_SEEN_KEY]: true });

export type Renamed = { renamed: boolean; branch: string; reason: string | null };

const tried = new Set<string>();

/** Names the placeholder branch of `dir` after `task`, once per folder. The back end leaves a branch that already has a name of its own, or an upstream, alone. */
export async function nameBranchFor(dir: string, task: string, settings: Record<string, unknown>, call: typeof invoke = invoke): Promise<Renamed | null> {
  if (!autoBranchOn(settings) || task.trim() === "" || tried.has(dir)) return null;
  tried.add(dir);
  const w = writerOf(settings);
  try {
    return await call<Renamed>("scm_name_branch", { worktree: dir, task, writer: w.mode === "off" ? null : writerArgs(w) });
  } catch {
    return null;
  }
}

export const forgetNamed = (dir?: string) => (dir === undefined ? tried.clear() : tried.delete(dir));
