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
  /** GIT-015: the merge, rebase, cherry-pick or revert stopped part-way. */
  operation: string | null;
  /** GIT-015: conflicted files with their clash markers gone, waiting to be staged. */
  resolved: string[];
};

/** GIT-065: whether a workspace's commits are on its remote (`scm_pushed`). */
export type Pushed = { path: string; state: "synced" | "ahead" | "unpublished" | "unknown"; count: number };

/** GIT-065: the sidebar badge; none for a detached HEAD or a new branch with nothing of its own yet. */
export function pushBadge(p: Pushed | undefined): { text: string; tone: "good" | "warn" } | null {
  if (!p) return null;
  if (p.state === "synced") return { text: "synced", tone: "good" };
  if (p.state === "ahead") return { text: `${p.count} unpushed`, tone: "warn" };
  if (p.state === "unknown") return { text: "cannot be checked", tone: "warn" };
  return p.count > 0 ? { text: `unpublished \u00b7 ${p.count}`, tone: "warn" } : null;
}

export const emptyStatus: Status = { branch: null, upstream: null, ahead: 0, behind: 0, rewritten: false, base: null, head: null, staged: [], changed: [], untracked: [], conflicts: [], operation: null, resolved: [] };

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

/** The sections whose rows can be discarded (VIEW-067); conflicts are resolved, not discarded. */
export type Section = "Staged" | "Changes" | "Untracked";

/** What a discard prompt says and which paths it hands to git. */
export type DiscardAsk = { title: string; body: string; confirm: string; paths: string[] };

/** VIEW-067: an untracked or newly added file is deleted, a deleted tracked file is restored,
 * anything else loses its changes. */
const discardKind = (section: Section, c: Change): "delete" | "restore" | "discard" => (section === "Untracked" || c.status === "A" ? "delete" : c.status === "D" ? "restore" : "discard");

const lost = " This cannot be undone.";

/** VIEW-067: the confirmation for discarding these rows of one section (all of it when `all`), in
 * singular or plural; a staged rename sends its old name too, so it comes back. */
export const discardAsk = (section: Section, rows: Change[], all: boolean): DiscardAsk => {
  const paths = rows.flatMap((r) => (section === "Staged" && r.from ? [r.from, r.path] : [r.path]));
  const kinds = rows.map((r) => discardKind(section, r));
  if (!all && rows.length === 1) {
    const name = rows[0].path;
    if (kinds[0] === "delete")
      return { title: `Delete ${name}?`, body: (section === "Untracked" ? "It is untracked, so it is deleted from disk." : "It is a staged new file, so discarding deletes it from disk, not just from the index.") + lost, confirm: "Delete", paths };
    if (kinds[0] === "restore") return { title: `Restore ${name}?`, body: "The deleted file comes back as git last had it.", confirm: "Restore", paths };
    return { title: `Discard changes to ${name}?`, body: (section === "Staged" ? "Its staged and unstaged changes are lost." : "Its unstaged changes are lost; anything staged stays.") + lost, confirm: "Discard", paths };
  }
  const n = (k: (typeof kinds)[number]) => kinds.filter((x) => x === k).length;
  const [del, back, gone] = [n("delete"), n("restore"), n("discard")];
  const parts = [
    del > 0 && `${plural(del, "file")} ${del === 1 ? "is" : "are"} deleted`,
    back > 0 && `${plural(back, "deleted file")} ${back === 1 ? "is" : "are"} restored`,
    gone > 0 && `${plural(gone, "file")} ${gone === 1 ? "loses its" : "lose their"} changes`,
  ].filter(Boolean);
  const stagedNew = section === "Staged" && del > 0 ? " Staged new files are deleted, not just unstaged." : "";
  return { title: `Discard all ${rows.length} in ${section}?`, body: `${parts.join("; ")}.${stagedNew}${del + gone > 0 ? lost : ""}`, confirm: "Discard all", paths };
};

export type RemoteAction = "push" | "pull" | "sync" | "fetch" | "ff" | "force" | "publish" | "rebase" | "pullpush";

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

/** GIT-035: one commit of the history as `scm_history` gives it. */
export type Commit = { hash: string; short: string; parents: string[]; author: string; time: number; subject: string; message: string; labels: { name: string; kind: string }[]; outgoing: boolean; incoming: boolean };

/** GIT-035: a lane waiting for the commit `hash`; `color` stays with the lane while it lasts. */
export type Lane = { hash: string; color: number };
export type GraphRow = { hash: string; parents: string[]; col: number; color: number; lanesIn: Lane[]; lanesOut: Lane[] };

/** GIT-035: lays commits (newest first, topological order) out on lanes. Each row keeps the lanes
 * coming in from above and going out below, which is all that is needed to draw it. */
export function graph(commits: Commit[]): GraphRow[] {
  let lanes: Lane[] = [];
  let next = 0;
  return commits.map((c) => {
    const lanesIn = lanes;
    let col = lanes.findIndex((l) => l.hash === c.hash);
    let out = lanes.slice();
    let color: number;
    if (col < 0) {
      col = out.length;
      color = next++;
      out.push({ hash: c.hash, color });
    } else color = out[col].color;
    // Other lanes waiting for this commit end in it (they all sit after `col`).
    out = out.filter((l, i) => i === col || l.hash !== c.hash);
    const [first, ...rest] = c.parents;
    if (first === undefined) out.splice(col, 1);
    else out[col] = { hash: first, color };
    for (const p of rest) if (!out.some((l) => l.hash === p)) out.push({ hash: p, color: next++ });
    lanes = out;
    return { hash: c.hash, parents: c.parents, col, color, lanesIn, lanesOut: out };
  });
}

/** One stroke of a row: from lane `from` to lane `to`, starting at the top edge or the dot and
 * ending at the dot or the bottom edge. */
export type Stroke = { from: number; to: number; top: boolean; bottom: boolean; color: number };

/** GIT-035: the strokes of one row: lanes ending in the dot, lanes passing by (kept by identity,
 * so two lanes waiting for one commit stay apart), and the dot's lines down to its parents. */
export function graphLines(r: GraphRow): Stroke[] {
  const lines: Stroke[] = r.lanesIn.map((l, j) => (l.hash === r.hash ? { from: j, to: r.col, top: true, bottom: false, color: l.color } : { from: j, to: r.lanesOut.indexOf(l), top: true, bottom: true, color: l.color }));
  r.parents.forEach((p, i) => {
    const k = i === 0 ? r.col : r.lanesOut.findIndex((o) => o.hash === p);
    if (k >= 0) lines.push({ from: r.col, to: k, top: false, bottom: true, color: r.lanesOut[k].color });
  });
  return lines;
}

/** GIT-036: what Explain changes asks the agent. */
export const explainPrompt = (c: Commit): string => `Explain the changes in commit ${c.hash} ("${c.subject}") in plain language: what changed, why it probably changed, and anything that looks risky. Read it with: git show ${c.hash}`;

/** GIT-021: a branch's pull request; `state` is OPEN, MERGED or CLOSED; `head` its branch. */
export type Pr = { number: number; url: string; state: string; title?: string | null; head?: string | null; draft?: boolean };

/** GIT-025: the settings key of the pull requests linked by hand, by worktree path. */
export const SCM_LINKED_PR_KEY = "scmLinkedPrs";

/** GIT-025: the saved links, keeping only text values. */
export const linkedPrs = (v: unknown): Record<string, string> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, u]) => typeof u === "string")) : {};

/** GIT-025: the links with one workspace's set, or removed when `url` is null. */
export const withLink = (map: Record<string, string>, dir: string, url: string | null): Record<string, string> => {
  const next = { ...map };
  if (url === null) delete next[dir];
  else next[dir] = url;
  return next;
};

/** GIT-025: a hand link whose branch is not the workspace's is flagged, never quietly replaced. */
export const prMismatch = (pr: Pr | null, branch: string | null): string | null => (pr?.head && branch && pr.head !== branch ? `Linked by hand to the pull request for ${pr.head}, not ${branch}` : null);

/** GIT-025: the state as the panel shows it. */
export const prStateWord = (pr: Pr): string => (pr.state === "OPEN" ? (pr.draft ? "Draft" : "Open") : pr.state === "MERGED" ? "Merged" : pr.state === "CLOSED" ? "Closed" : pr.state);
/** GIT-023: what the panel knows of the branch's pull request while it looks it up. */
export type PrLook = { loading: boolean; pr: Pr | null; error: string | null };

/** GIT-027: how often the shown pull request is looked up again, and how old it may get before
 * the window gaining focus looks it up at once. */
export const PR_STALE_MS = 60_000;
/** GIT-027: the wait before the next lookup; each failure in a row doubles it, up to 15 minutes. */
export const prRefreshDelay = (failures: number): number => Math.min(PR_STALE_MS * 2 ** Math.min(failures, 10), 15 * 60_000);
/** GIT-027: a lookup's answer; a failure keeps the pull request known last, with the reason. */
export const prLooked = (prev: PrLook, got: { pr: Pr | null } | { error: string }): PrLook => ("error" in got ? { loading: false, pr: prev.pr, error: got.error } : { loading: false, pr: got.pr, error: null });

/** GIT-023: why Create pull request cannot run yet, null when it can. Untracked files do not
 * block it; tracked changes, a missing push and a missing base do. */
export const prReason = (s: Status | null, look: PrLook): string | null => {
  if (s === null) return "Loading";
  if (s.conflicts.length > 0) return "Resolve the conflicts first";
  if (s.staged.length + s.changed.length > 0) return "Commit your changes first";
  if (s.branch === null) return "No branch checked out";
  if (s.base !== null && (s.base === s.branch || s.base === `origin/${s.branch}`)) return "Move to a feature branch first";
  if (s.upstream === null) return "Push the branch first";
  if (!s.upstream.startsWith("origin/")) return `Fork head not supported: the branch tracks ${s.upstream}; push it to origin first`;
  if (s.behind > 0) return `Sync first: the remote has ${plural(s.behind, "commit")} this copy lacks`;
  if (s.ahead > 0) return `Push ${plural(s.ahead, "commit")} first`;
  if (s.base === null) return "No base branch on the remote";
  if (look.loading) return "Checking for a pull request";
  if (look.error) return look.error;
  if (look.pr?.state === "MERGED") return `Pull request #${look.pr.number} already merged`;
  return null;
};

/** GIT-021: the main button's pull-request step waits while the check loads and opens the
 * branch's open pull request once it has one. Other steps pass through. */
export const withPr = (step: Step, s: Status | null, look: PrLook): Step => {
  if (step.action !== "pr") return step;
  if (look.pr?.state === "OPEN") return { label: `Open pull request #${look.pr.number}`, action: "pr", reason: null };
  return { ...step, reason: prReason(s, look) };
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
export type Summary = { against: string; ahead: number; behind: number; source: Lines; tests: Lines; generated: Lines; files: number; committed: Change[] };

/** GIT-011: the branch row's file count. */
export const filesWord = (n: number): string => `${n} ${n === 1 ? "file" : "files"} changed`;

const CLASHES: Record<string, string> = { UU: "changed on both sides", AA: "added on both sides", DD: "deleted on both sides", DU: "deleted on one side", UD: "deleted on one side", AU: "added on one side", UA: "added on one side" };
/** GIT-015: the kind of clash, from git's two-letter conflict code. */
export const clashWord = (code: string): string => CLASHES[code] ?? "in conflict";
/** GIT-015: the abort button names the operation it ends; none without one. */
export const abortLabel = (op: string | null | undefined): string | null => (op ? `Abort ${op}` : null);
/** GIT-015: the most conflict cards drawn; the rest are counted. */
export const CONFLICT_CAP = 100;
export const capped = <T>(rows: T[], cap: number): { shown: T[]; more: number } => ({ shown: rows.slice(0, cap), more: Math.max(0, rows.length - cap) });

/** GIT-066: the settings key of the order the Source Control groups are listed in. */
export const SCM_GROUP_ORDER_KEY = "scmGroupOrder";
export type ScmGroup = "conflicts" | "staged" | "changes" | "untracked";
/** GIT-066: the orders on offer, `[id, label, groups]`; conflicts lead in each, since they block a commit. */
export const SCM_GROUP_ORDERS: [string, string, ScmGroup[]][] = [
  ["staged-first", "Staged first", ["conflicts", "staged", "changes", "untracked"]],
  ["changes-first", "Changes first", ["conflicts", "changes", "untracked", "staged"]],
];
/** GIT-066: the groups in the saved order; anything else reads as the first one. */
export const scmGroups = (order: unknown): ScmGroup[] => (SCM_GROUP_ORDERS.find((o) => o[0] === order) ?? SCM_GROUP_ORDERS[0])[2];

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
export type ActionOutcome = { ok: boolean; output: string; kind?: FailureKind | null; detail?: string | null };
/** GIT-009: how the back end sorted a failed remote action. */
export type FailureKind = "protected" | "sign-in" | "network" | "submodule" | "non-fast-forward" | "hook" | "other";

const FAILURE_WORDS: Record<FailureKind, string> = {
  protected: "refused: the branch is protected on the remote",
  "sign-in": "failed: the remote wants you to sign in",
  network: "failed: the remote could not be reached",
  submodule: "failed: a submodule has commits that are not on its remote",
  "non-fast-forward": "refused: the remote has commits this copy lacks; pull first",
  hook: "blocked by a hook (a lint or test check failed)",
  other: "failed",
};

/** GIT-009: the notice's title, naming the kind of failure. */
export const failureTitle = (label: string, out: ActionOutcome): string => `${label} ${FAILURE_WORDS[out.kind ?? "other"]}`;

/** GIT-005: one item of the commit button's dropdown; `id` is the remote step after the commit. */
export type CommitItem = { id: "push" | "sync" | "force" | "pullpush"; label: string; title: string; reason: string | null };

/** GIT-005: commit and push, sync, force push with lease, or pull and push; each says why when it cannot run. */
export const commitItems = (s: Status | null, message: string): CommitItem[] => {
  const st = s ?? emptyStatus;
  const first =
    s === null ? "Loading" : st.conflicts.length > 0 ? "Resolve the conflicts first" : st.staged.length === 0 ? "Nothing staged to commit" : !message.trim() ? "Write a commit message first" : st.upstream === null ? "Branch unpublished; publish it first" : null;
  const item = (id: CommitItem["id"], label: string, title: string, own: string | null = null): CommitItem => ({ id, label, title, reason: first ?? own });
  return [
    item("push", "Commit and push", "Commit, then push; nothing is pushed when the commit fails", st.behind > 0 ? `The remote has ${plural(st.behind, "commit")} this copy lacks; use commit and sync` : null),
    item("sync", "Commit and sync", "Commit, then pull and push"),
    item("force", "Commit and force push", "Commit, then push with a lease: commits on the remote that this copy has not seen are never overwritten"),
    item("pullpush", "Commit, then pull and push", "Commit, then pull (rebasing the new commit onto the remote's) and push"),
  ];
};

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

/** GIT-033: what the merge box reads, in one GraphQL call when it is opened (`scm_merge_info`). */
export type MergeInfo = { state: string; draft: boolean; mergeable: string; mergeState: string; review: string | null; checks: string | null; inQueue: boolean; queueEnabled: boolean; autoMerge: string | null; methods: string[]; autoAllowed: boolean };
export type MergeAction = { action: "merge" | "auto" | "disable-auto" | "queue" | "ready" | "close" | "reopen"; method: string | null; label: string };

const METHOD_WORDS: Record<string, string> = { merge: "Create a merge commit", squash: "Squash and merge", rebase: "Rebase and merge" };

/** What holds an open pull request back, or "Ready to merge". */
function mergeHold(m: MergeInfo): string {
  if (m.mergeable === "CONFLICTING" || m.mergeState === "DIRTY") return "Conflicts";
  if (m.review === "CHANGES_REQUESTED") return "Changes requested";
  if (m.checks === "FAILURE" || m.checks === "ERROR") return "Checks failed";
  if (m.checks === "PENDING" || m.checks === "EXPECTED") return "Checks pending";
  if (m.review === "REVIEW_REQUIRED") return "Approval required";
  if (m.mergeState === "BEHIND") return "Behind the base branch";
  if (m.mergeState === "BLOCKED") return "Blocked";
  if (m.mergeable === "UNKNOWN" || m.mergeState === "UNKNOWN") return "Checking";
  return "Ready to merge";
}

export function mergeLabel(m: MergeInfo): string {
  if (m.state === "MERGED") return "Merged";
  if (m.state === "CLOSED") return "Closed";
  if (m.inQueue) return "In merge queue";
  if (m.draft) return "Draft";
  const hold = mergeHold(m);
  return m.autoMerge ? `Auto-merge on (${m.autoMerge}) · ${hold}` : hold;
}

/** Only the actions possible right now; merge methods are the repository's own. */
export function mergeActions(m: MergeInfo): MergeAction[] {
  if (m.state === "MERGED") return [];
  if (m.state === "CLOSED") return [{ action: "reopen", method: null, label: "Reopen" }];
  const close: MergeAction = { action: "close", method: null, label: "Close pull request" };
  if (m.draft) return [{ action: "ready", method: null, label: "Mark ready for review" }, close];
  const hold = mergeHold(m);
  if (m.inQueue || hold === "Conflicts") return [close];
  if (m.queueEnabled) return [{ action: "queue", method: null, label: "Add to merge queue" }, close];
  if (m.autoMerge) return [{ action: "disable-auto", method: null, label: "Turn off auto-merge" }, close];
  const methods = m.methods.filter((x) => x in METHOD_WORDS);
  if (hold === "Ready to merge") return [...methods.map((x): MergeAction => ({ action: "merge", method: x, label: METHOD_WORDS[x] })), close];
  const unstable = m.mergeState === "UNSTABLE" || hold === "Checks failed";
  if (m.autoAllowed && !unstable) return [...methods.map((x): MergeAction => ({ action: "auto", method: x, label: `${METHOD_WORDS[x]} when ready` })), close];
  return [close];
}

/** GIT-028: one GitHub API budget (`scm_gh_budget`); `reset` is in Unix seconds. */
export type Budget = { name: string; limit: number; remaining: number; reset: number };

export function budgetLine(b: Budget, nowSec: number): string {
  const mins = Math.max(1, Math.ceil((b.reset - nowSec) / 60));
  const n = (x: number) => x.toLocaleString("en-US");
  return `${b.name}: ${b.remaining === 0 ? "used up" : `${n(b.remaining)} of ${n(b.limit)} left`}, resets in ${mins} min`;
}

/** Under a tenth left. */
export const budgetLow = (b: Budget): boolean => b.remaining * 10 < b.limit;
