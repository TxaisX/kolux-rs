// GIT-010 (T-313-b): the notice that names the fork a branch will push to. The back end
// (`scm_push_target`) answers only for a branch whose push goes to a repository other than the
// project's own, so a plain branch shows nothing. Pushing itself is done there: a branch taken from a
// fork's pull request is pushed to the fork's branch of the pull request's own name.
import { invoke } from "@tauri-apps/api/core";

export type PushTarget = { branch: string; remote: string; remoteBranch: string; url: string; fork: string | null };

/** The sentence the panel shows; null when the push is to the project's own repository. */
export function forkNotice(t: PushTarget | null | undefined): string | null {
  if (!t || !t.fork) return null;
  const as = t.remoteBranch !== t.branch ? ` as ${t.remoteBranch}` : "";
  return `Pushes to the fork ${t.fork} (remote ${t.remote})${as}, not to origin.`;
}

/** Asks the back end where `worktree`'s branch pushes; a failure means no notice. */
export const loadPushTarget = (worktree: string): Promise<PushTarget | null> => invoke<PushTarget | null>("scm_push_target", { worktree }).catch(() => null);
