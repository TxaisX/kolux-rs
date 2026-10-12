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
  /** The commit HEAD points at; VIEW-068 measures the branch again when it moves. */
  head: string | null;
  staged: Change[];
  changed: Change[];
  untracked: Change[];
  conflicts: Change[];
};

export const emptyStatus: Status = { branch: null, upstream: null, ahead: 0, behind: 0, rewritten: false, base: null, head: null, staged: [], changed: [], untracked: [], conflicts: [] };

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

/** VIEW-068: lines added and removed in one row of the branch summary. */
export type Lines = { added: number; removed: number };

/** VIEW-068: the branch against `against` (the pinned base, the upstream or the default branch). */
export type Summary = { against: string; ahead: number; behind: number; source: Lines; tests: Lines; generated: Lines };

/** The settings key of the off-by-default choice to measure against the branch's upstream. */
export const SUMMARY_UPSTREAM_KEY = "scmSummaryUpstream";

/** Full numbers with grouped digits, never 8.3k. */
export const grouped = (n: number): string => n.toLocaleString("en-US");

export const summaryTotal = (s: Summary): Lines => ({ added: s.source.added + s.tests.added + s.generated.added, removed: s.source.removed + s.tests.removed + s.generated.removed });

const empty = (l: Lines) => l.added + l.removed === 0;

/** The rows that add up to the total: source, tests and generated; with no test lines the rest is
 * "Non-generated", and an empty generated row is left out. */
export const summaryRows = (s: Summary): (Lines & { label: string })[] => [
  ...(empty(s.tests) ? [{ label: "Non-generated", ...s.source }] : [{ label: "Source", ...s.source }, { label: "Tests", ...s.tests }]),
  ...(empty(s.generated) ? [] : [{ label: "Generated", ...s.generated }]),
];

/** What a screen reader hears on the summary, collapsed or not: the totals and the split. */
export const summaryLabel = (branch: string | null, s: Summary): string => {
  const t = summaryTotal(s);
  const split = summaryRows(s).map((r) => `${r.label.toLowerCase()} ${grouped(r.added)} added ${grouped(r.removed)} removed`).join(", ");
  return `${branch ?? "Detached HEAD"}, ${s.ahead} ahead and ${s.behind} behind ${s.against}, ${grouped(t.added)} line${t.added === 1 ? "" : "s"} added and ${grouped(t.removed)} removed: ${split}`;
};

/** GIT-002: every row's path in display order (conflicts, staged, changes, untracked), each once;
 * a file with staged and unstaged parts sits in two sections and is one selection. */
export const rowOrder = (s: Status): string[] => [...new Set([...s.conflicts, ...s.staged, ...s.changed, ...s.untracked].map((c) => c.path))];

export type SelectMode = "one" | "toggle" | "span";

/** GIT-002: the selection after a click on `path`. A plain click keeps that row alone (and clears
 * it when it was the only one selected), Ctrl adds or removes it, Shift takes the span from the
 * last clicked row in list order. Rows no longer listed drop out. */
export const select = (selected: string[], order: string[], path: string, mode: SelectMode, anchor: string | null): string[] => {
  const live = selected.filter((p) => order.includes(p));
  if (mode === "toggle") return live.includes(path) ? live.filter((p) => p !== path) : [...live, path];
  if (mode === "span" && anchor !== null && order.includes(anchor)) {
    const [a, b] = [order.indexOf(anchor), order.indexOf(path)].sort((x, y) => x - y);
    return order.slice(a, b + 1);
  }
  return live.length === 1 && live[0] === path ? [] : [path];
};

/** GIT-002: what the bulk bar covers: the selected rows still listed, the ones that can be staged
 * (conflicts, changes, untracked) and the ones that can be unstaged (staged), in display order. */
export const bulk = (s: Status, selected: string[]): { present: string[]; stage: string[]; unstage: string[] } => {
  const present = rowOrder(s).filter((p) => selected.includes(p));
  const stageable = new Set([...s.conflicts, ...s.changed, ...s.untracked].map((c) => c.path));
  const staged = new Set(s.staged.map((c) => c.path));
  return { present, stage: present.filter((p) => stageable.has(p)), unstage: present.filter((p) => staged.has(p)) };
};

/** What a remote action came to (GIT-007). */
export type ActionOutcome = { ok: boolean; output: string };

/** EDIT-040: one workspace's handoff note as the back end keeps it. */
export type Note = { text: string; updated: number | null };

const two = (n: number) => String(n).padStart(2, "0");

/** EDIT-040: the note after handing it to `agent`: a dated line saying who received it. */
export const handedLine = (text: string, agent: string, at: Date): string => {
  const line = `— Handed to ${agent} on ${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`;
  const kept = text.trimEnd();
  return kept ? `${kept}\n\n${line}` : line;
};

/** EDIT-040: how long since the note last changed, in the largest whole unit. */
export const sinceText = (updated: number, now: number): string => {
  const min = Math.floor((now - updated) / 60_000);
  if (min < 1) return "Changed just now";
  if (min < 60) return `Changed ${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `Changed ${h} h ago` : `Changed ${Math.floor(h / 24)} d ago`;
};

/** VIEW-069: the opening prompt for an agent asked to resolve the merge conflicts. */
export const conflictPrompt = (files: Change[]): string =>
  `This workspace has merge conflicts in:\n${files.map((f) => `- ${f.path}`).join("\n")}\n\nResolve each conflict, keeping what both sides meant, stage the resolved files, and finish the merge or rebase that is in progress. Where the two sides disagree, say which one you kept and why.`;

/** VIEW-069: the settings key of the agent saved for agent actions. */
export const SCM_AGENT_KEY = "scmAgent";

/** VIEW-069: the agent saved for Source Control's agent actions, while it is still installed. */
export const savedFixAgent = <A extends { id: string; installed: boolean }>(agents: A[], saved: unknown): A | null =>
  typeof saved === "string" ? (agents.find((a) => a.id === saved && a.installed) ?? null) : null;
