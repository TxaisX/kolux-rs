// The Source Control panel's data (GIT-002 / GIT-004): a worktree's status as the back end
// reports it, and the two rules the panel applies before it commits.

/** One changed file; `status` is one letter (M A D R C T U untracked, X unmerged). */
export type Change = { path: string; status: string; from: string | null };

export type Status = {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** GIT-006: after a rebase, the upstream holds only patches HEAD already has. */
  rewritten: boolean;
  base: string | null;
  staged: Change[];
  changed: Change[];
  untracked: Change[];
  conflicts: Change[];
};

export const emptyStatus: Status = { branch: null, upstream: null, ahead: 0, behind: 0, rewritten: false, base: null, staged: [], changed: [], untracked: [], conflicts: [] };

/** What a commit attempt came to (GIT-004): `id` when it worked, else git's words and whether a hook refused. */
export type CommitOutcome = { id: string | null; blocked: boolean; output: string };

/** GIT-004: Commit is enabled with staged work, a message that is not blank, and no unresolved conflict. */
export const canCommit = (s: Status | null, message: string): boolean => s !== null && s.staged.length > 0 && s.conflicts.length === 0 && message.trim().length > 0;

export type KeyLike = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing?: boolean };

/** GIT-004: Ctrl+Enter (Cmd+Enter on macOS) and nothing else held; a keystroke that is still
 * part of an input-method composition is not a shortcut. */
export const isCommitShortcut = (e: KeyLike): boolean => e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && !e.isComposing;

/** The sum of every section, for the panel's header. */
export const changeCount = (s: Status | null): number => (s ? s.staged.length + s.changed.length + s.untracked.length + s.conflicts.length : 0);

export type RemoteAction = "push" | "pull" | "sync" | "fetch" | "ff" | "force" | "publish" | "rebase";

/** What the main button offers; `reason` is why it waits, null when it can go. */
export type Step = { label: string; action: "stage" | "commit" | "pr" | RemoteAction; reason: string | null };

/** GIT-006: the next step for the branch's state, in the card's own order. */
export const nextStep = (s: Status | null, message: string): Step => {
  if (s === null) return { label: "Commit", action: "commit", reason: "Loading" };
  if (s.conflicts.length > 0) return { label: "Commit", action: "commit", reason: "Resolve the conflicts first" };
  if (s.staged.length > 0) return { label: "Commit", action: "commit", reason: message.trim() ? null : "Write a message first" };
  if (s.changed.length + s.untracked.length > 0) return { label: "Stage all", action: "stage", reason: null };
  if (s.branch === null) return { label: "Publish branch", action: "publish", reason: "HEAD is detached" };
  if (s.upstream === null) return { label: "Publish branch", action: "publish", reason: null };
  if (s.rewritten) return { label: "Force push with lease", action: "force", reason: null };
  if (s.ahead > 0 && s.behind > 0) return { label: `Sync \u2193${s.behind} \u2191${s.ahead}`, action: "sync", reason: null };
  if (s.behind > 0) return { label: `Pull ${s.behind}`, action: "pull", reason: null };
  if (s.ahead > 0) return { label: `Push ${s.ahead}`, action: "push", reason: null };
  return { label: "Create pull request", action: "pr", reason: null };
};

export type RemoteItem = { id: RemoteAction; label: string; reason: string | null };

const plural = (k: number, word: string) => `${k} ${word}${k === 1 ? "" : "s"}`;

/** GIT-007: the remote menu, every item with its count and, when it cannot run, the reason. */
export const remoteItems = (s: Status | null): RemoteItem[] => {
  const st = s ?? emptyStatus;
  const noBranch = s === null ? "Loading" : st.branch === null ? "No branch checked out" : null;
  const unpublished = noBranch ?? (st.upstream === null ? "Branch unpublished" : null);
  const onBase = st.base !== null && (st.base === st.branch || st.base === `origin/${st.branch}`);
  return [
    { id: "push", label: st.ahead > 0 ? `Push ${plural(st.ahead, "commit")}` : "Push", reason: unpublished ?? (st.ahead === 0 ? "Nothing to push" : null) },
    { id: "pull", label: st.behind > 0 ? `Pull ${plural(st.behind, "commit")}` : "Pull", reason: unpublished ?? (st.behind === 0 ? "Nothing to pull" : null) },
    { id: "sync", label: `Sync \u2193${st.behind} \u2191${st.ahead}`, reason: unpublished ?? (st.ahead + st.behind === 0 ? "Already current" : null) },
    { id: "fetch", label: "Fetch", reason: noBranch },
    { id: "ff", label: st.behind > 0 ? `Fast-forward ${plural(st.behind, "commit")}` : "Fast-forward", reason: unpublished ?? (st.behind === 0 ? "Already current" : st.ahead > 0 ? "Local commits are in the way" : null) },
    { id: "force", label: "Force push with lease", reason: unpublished ?? (st.ahead === 0 ? "Nothing to push" : null) },
    { id: "publish", label: "Publish branch", reason: noBranch ?? (st.upstream !== null ? "Already published" : null) },
    { id: "rebase", label: st.base ? `Rebase from ${st.base}` : "Rebase from base", reason: noBranch ?? (st.base === null ? "No base branch" : onBase ? "This is the base branch" : null) },
  ];
};

/** What a remote action came to (GIT-007). */
export type ActionOutcome = { ok: boolean; output: string };
