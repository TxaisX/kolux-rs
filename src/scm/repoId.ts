// Row 917: the provider-neutral id of a repository (scm_repo_id), the key of its per-repository AI switch.
import { invoke } from "@tauri-apps/api/core";
import type { RepoRef } from "./recipes";

/** The id of `dir`'s repository, or null when it cannot be read right now; null keeps AI off while any repository is switched off (aiShownFor). */
export async function readRepoRef(dir: string): Promise<RepoRef | null> {
  const r = await invoke<{ id?: unknown; legacy?: unknown } | null>("scm_repo_id", { worktree: dir }).catch(() => null);
  return r && typeof r.id === "string" && r.id !== "" ? { id: r.id, legacy: typeof r.legacy === "string" ? r.legacy : null } : null;
}
