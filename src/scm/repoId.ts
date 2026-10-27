// Row 917: the provider-neutral id of a repository (scm_repo_id), the key of its per-repository AI switch.
import { invoke } from "@tauri-apps/api/core";
import type { RepoRef } from "./recipes";

/** The id of `dir`'s repository, or null when it cannot be read right now; null keeps AI off while any repository is switched off (aiShownFor). */
export async function readRepoRef(dir: string): Promise<RepoRef | null> {
  const r = await invoke<{ id?: unknown; legacy?: unknown; also?: unknown } | null>("scm_repo_id", { worktree: dir }).catch(() => null);
  return r && typeof r.id === "string" && r.id !== "" ? { id: r.id, legacy: typeof r.legacy === "string" ? r.legacy : null, also: Array.isArray(r.also) ? r.also.filter((k): k is string => typeof k === "string") : [] } : null;
}

/** A repository typed or pasted in Settings (URL, scp form, folder path, host/owner/name) as the id the app resolves for it; null when it cannot be normalized. */
export async function typedRepoId(text: string): Promise<string | null> {
  const id = await invoke<unknown>("scm_repo_id_of", { text }).catch(() => null);
  return typeof id === "string" && id.trim() !== "" ? id : null;
}
