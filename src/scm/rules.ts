// T-225-b: the rest of the Source Control rules (VIEW-062..065, VIEW-070) as pure functions, so
// each one is proven by a unit test and the panel only asks. No back-end calls here.
import { fullPath, type Change, type Pr, type PrLook, type RemoteAction, type RowKey, type Status, type Step } from "./model";

// ---- VIEW-062: a long list is windowed -------------------------------------------------------

/** Rows to draw for a scrolled list: only the visible part plus a little either side. */
export function windowRange(total: number, scrollTop: number, viewport: number, rowHeight: number, overscan = 6): { start: number; end: number; padTop: number; padBottom: number } {
  if (total <= 0 || rowHeight <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(total, Math.ceil((scrollTop + Math.max(viewport, 0)) / rowHeight) + overscan);
  const start = Math.min(first, total);
  const end = Math.max(start, last);
  return { start, end, padTop: start * rowHeight, padBottom: (total - end) * rowHeight };
}

/** Past this many tracked files the panel warns once; the warning can be dismissed for good. */
export const HUGE_REPO_FILES = 50_000;
export const SCM_HUGE_DISMISSED_KEY = "scmHugeDismissed";

export const hugeDismissed = (v: unknown, repo: string): boolean => typeof v === "object" && v !== null && (v as Record<string, unknown>)[repo] === true;
export const dismissHuge = (v: unknown, repo: string): Record<string, boolean> => ({ ...(typeof v === "object" && v !== null ? (v as Record<string, boolean>) : {}), [repo]: true });
/** The warning line, or null when the repository is not huge or the warning was dismissed. */
export function hugeWarning(trackedFiles: number, dismissed: unknown, repo: string): string | null {
  if (trackedFiles < HUGE_REPO_FILES || hugeDismissed(dismissed, repo)) return null;
  return `This repository has ${trackedFiles.toLocaleString("en-US")} files, so status can be slow. The list stays responsive; dismiss this to stop seeing it.`;
}

/** A change set this big shows the banner instead of listing every row. */
export const BIG_CHANGE_SET = 2_000;
export const bigChangeBanner = (count: number): string | null => (count >= BIG_CHANGE_SET ? `${count.toLocaleString("en-US")} files changed. Only the first rows of each section are listed; use the filter or All Changes to reach the rest.` : null);

// ---- VIEW-062: submodules expand in place ----------------------------------------------------

export type SubRow = { path: string; detail: string; open: boolean; dir: string };
/** Changed submodules as rows; an open one is read as its own repository at `dir`. */
export const submoduleRows = (s: Status | null, worktree: string, open: ReadonlySet<string>): SubRow[] =>
  Object.entries(s?.submodules ?? {}).map(([path, detail]) => ({ path, detail, open: open.has(path), dir: fullPath(worktree, path) }));
export const toggleSub = (open: ReadonlySet<string>, path: string): Set<string> => {
  const next = new Set(open);
  if (!next.delete(path)) next.add(path);
  return next;
};

// ---- VIEW-062: refresh order, backoff, push triggers, never-older status ----------------------

/** The active worktree refreshes first, then the visible ones in order, then the rest; no repeats. */
export function refreshOrder(all: string[], active: string | null, visible: string[]): string[] {
  const out: string[] = [];
  const push = (p: string | null) => {
    if (p !== null && all.includes(p) && !out.includes(p)) out.push(p);
  };
  push(active);
  visible.forEach(push);
  all.forEach(push);
  return out;
}

/** A slow refresh waits longer before the next: three times as long as it took (at least 2 s, at most 60 s), doubled per failure in a row. */
export function refreshGap(lastTookMs: number, failures: number): number {
  const base = Math.min(60_000, Math.max(2_000, Math.round(lastTookMs * 3)));
  return Math.min(60_000, base * 2 ** Math.min(Math.max(failures, 0), 5));
}

/** A push, a pull or an upstream move shows up as a change in these fields; it triggers a refresh. */
export const remoteMoved = (prev: Status | null, next: Status | null): boolean =>
  prev !== null && next !== null && (prev.upstream !== next.upstream || prev.ahead !== next.ahead || prev.behind !== next.behind || prev.head !== next.head);

/** Each lookup takes a ticket; an answer is applied only if no later ticket has been applied already. */
export function statusGuard() {
  let issued = 0;
  let applied = 0;
  return {
    begin: (): number => ++issued,
    accept(ticket: number): boolean {
      if (ticket <= applied) return false;
      applied = ticket;
      return true;
    },
  };
}

/** An automatic refresh that fails keeps the last good status on screen (with the reason); a
 * manual one, or one with nothing on screen, shows the failure. */
export function afterRefresh(prev: Status | null, got: Status | { error: string }, auto: boolean): { status: Status | null; error: string | null } {
  if (!("error" in got)) return { status: got, error: null };
  return { status: auto ? prev : null, error: got.error };
}

// ---- VIEW-062: which row the open tab highlights ---------------------------------------------

export type OpenTab = { kind: "edit"; path: string } | { kind: "diff"; path: string; staged: boolean } | { kind: "compare"; path: string };
/** An editing tab marks the working-tree row first, the staged row only when there is no
 * working-tree change; a diff tab marks the side it shows; a branch-compare tab marks none. */
export function highlightRow(tab: OpenTab | null, s: Status | null): RowKey | null {
  if (tab === null || s === null || tab.kind === "compare") return null;
  const has = (rows: Change[]) => rows.some((r) => r.path === tab.path);
  if (tab.kind === "diff") return has(tab.staged ? s.staged : [...s.changed, ...s.untracked]) ? { section: tab.staged ? "Staged" : has(s.changed) ? "Changes" : "Untracked", path: tab.path } : null;
  if (has(s.changed)) return { section: "Changes", path: tab.path };
  if (has(s.untracked)) return { section: "Untracked", path: tab.path };
  if (has(s.staged)) return { section: "Staged", path: tab.path };
  return null;
}

// ---- VIEW-063: clicks, the context menu, unavailable icons ------------------------------------

export type ClickLike = { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean };
/** Mod (Command on a Mac, Control elsewhere), Shift or Alt opens a split; a plain click never does. */
export function openInSplit(e: ClickLike, mac: boolean): boolean {
  return (mac ? e.metaKey : e.ctrlKey) || e.shiftKey || e.altKey;
}

export type RowAction = { id: "stage" | "unstage" | "discard" | "open"; label: string; available: boolean; title: string };
/** The icons and context-menu items of a changed file. An unavailable one still has its tooltip
 * (the reason) and ignores clicks. */
export function rowActions(section: "Conflicts" | "Changes" | "Staged" | "Untracked", resolved = true): RowAction[] {
  const conflict = section === "Conflicts";
  return [
    { id: "stage", label: conflict ? "Stage as resolved" : "Stage", available: section !== "Staged" && (!conflict || resolved), title: section === "Staged" ? "Already staged" : conflict && !resolved ? "Resolve the clash markers first" : conflict ? "Stage as resolved" : "Stage this file" },
    { id: "unstage", label: "Unstage", available: section === "Staged", title: section === "Staged" ? "Unstage this file" : "Not staged" },
    { id: "discard", label: section === "Untracked" ? "Delete" : "Discard", available: !conflict, title: conflict ? "Resolve or abort the operation first" : section === "Untracked" ? "Delete this new file" : "Discard the changes in this file" },
    { id: "open", label: "Open", available: true, title: "Open the file" },
  ];
}
/** True when the click should run its action. */
export const runsAction = (a: RowAction): boolean => a.available;

// ---- VIEW-064: the commit box ----------------------------------------------------------------

export type FailureSummary = { summary: string; lint: boolean; details: boolean };
const LINT = /\b(eslint|lint-staged|prettier|stylelint|biome|ruff|flake8|pylint|rubocop|clippy|golangci|tslint|lint)\b/i;
/** One line for a failed commit. A failure from the lint step of the commit hooks is named as one
 * (with its problem count when the tool printed it) instead of a wall of tool output; the details
 * toggle is offered only when the full text says more than the summary does. */
export function failureSummary(output: string): FailureSummary {
  const text = output.replace(/\u001b\[[0-9;]*m/g, "").trim();
  if (text === "") return { summary: "The commit failed and git gave no reason", lint: false, details: false };
  if (LINT.test(text)) {
    const n = /(\d+)\s+problems?\b/i.exec(text) ?? /\b(\d+)\s+(?:errors?|warnings?)\b/i.exec(text.replace(/\d+:\d+\s+error\b/gi, ""));
    const summary = n ? `The lint step of the commit hooks failed: ${n[1]} ${Number(n[1]) === 1 ? "problem" : "problems"}` : "The lint step of the commit hooks failed";
    return { summary, lint: true, details: true };
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  const first = (lines.find((l) => /^(error|fatal|hint|husky)\b/i.test(l)) ?? lines[0]).replace(/^(error|fatal):\s*/i, "");
  const summary = first.length > 140 ? `${first.slice(0, 137)}...` : first;
  return { summary, lint: false, details: lines.length > 1 || first.length > 140 };
}
/** The recovery prompt offered with a failed commit. */
export const recoveryPrompt = (f: FailureSummary, output: string): string =>
  `${f.lint ? "The lint step of my commit hooks failed." : "My commit failed."} Fix what stopped it, stage the fixes, and tell me when the commit can be retried. Output:\n\n${output.trim().slice(0, 4000)}`;

/** When only submodule pointers changed, Stage All stays the main action in the commit area. */
export function submoduleOnly(s: Status | null): boolean {
  if (s === null) return false;
  const subs = new Set(Object.keys(s.submodules ?? {}));
  const unstaged = [...s.changed, ...s.untracked];
  return unstaged.length > 0 && unstaged.every((c) => subs.has(c.path));
}

/** While conflicts are unresolved or an operation is in progress the message box is disabled and the commit controls hidden. */
export function commitBox(s: Status | null): { boxDisabled: boolean; controlsHidden: boolean; why: string | null } {
  if (s === null) return { boxDisabled: false, controlsHidden: false, why: null };
  if (s.conflicts.length > 0) return { boxDisabled: true, controlsHidden: true, why: "Resolve the conflicts first" };
  if (s.operation) return { boxDisabled: true, controlsHidden: true, why: `A ${s.operation} is in progress` };
  return { boxDisabled: false, controlsHidden: false, why: null };
}

// ---- VIEW-064: generation defaults saved per repository or for all ----------------------------

export const GEN_DEFAULTS_KEY = "scmGenDefaults";
export type GenChoice = { agent: string; model: string | null; effort: string | null };
export type GenDefaults = { all: GenChoice | null; repos: Record<string, GenChoice> };
const isChoice = (v: unknown): v is GenChoice => typeof v === "object" && v !== null && typeof (v as GenChoice).agent === "string";
export function genDefaultsOf(v: unknown): GenDefaults {
  const o = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  const repos: Record<string, GenChoice> = {};
  if (typeof o.repos === "object" && o.repos !== null) for (const [k, c] of Object.entries(o.repos)) if (isChoice(c)) repos[k] = { agent: c.agent, model: c.model ?? null, effort: c.effort ?? null };
  return { all: isChoice(o.all) ? { agent: o.all.agent, model: o.all.model ?? null, effort: o.all.effort ?? null } : null, repos };
}
/** The saved choice for a repository: its own first, else the one for every repository. */
export const genDefault = (d: GenDefaults, repo: string): GenChoice | null => d.repos[repo] ?? d.all;
const same = (a: GenChoice | null, b: GenChoice | null) => a !== null && b !== null && a.agent === b.agent && a.model === b.model && a.effort === b.effort;
/** Which save buttons show: each hides once the current choice already is that saved default. */
export const saveOffers = (d: GenDefaults, repo: string, now: GenChoice): { repo: boolean; all: boolean } => ({ repo: !same(d.repos[repo] ?? null, now), all: !same(d.all, now) });
export function saveGenDefault(d: GenDefaults, scope: "repo" | "all", repo: string, now: GenChoice): GenDefaults {
  return scope === "all" ? { ...d, all: now } : { ...d, repos: { ...d.repos, [repo]: now } };
}

// ---- VIEW-065: the main git button ------------------------------------------------------------

/** The main button's step with the card's later rules: a branch that differs from its remote only
 * by equivalent patches is steered to Create PR (Force Push stays in the commit area); a detached
 * HEAD never offers Publish but offers Create PR when a compare base is known; Create PR waits
 * while a newer readiness check loads. */
export function mainStep(base: Step, s: Status | null, look: PrLook): { step: Step; forceInCommitArea: boolean } {
  if (s === null) return { step: base, forceInCommitArea: false };
  const clean = s.staged.length + s.changed.length + s.untracked.length + s.conflicts.length === 0;
  if (clean && s.branch === null) {
    if (s.base !== null) return { step: { label: "Create pull request", action: "pr", reason: look.loading ? "Checking for a pull request" : null }, forceInCommitArea: false };
    return { step: { label: "Create pull request", action: "pr", reason: "HEAD is detached and no compare base is known" }, forceInCommitArea: false };
  }
  if (clean && s.rewritten && s.upstream !== null && s.branch !== null) {
    const open = look.pr?.state === "OPEN";
    return { step: open ? { label: `Open pull request #${look.pr?.number}`, action: "pr", reason: null } : { label: "Create pull request", action: "pr", reason: look.loading ? "Checking for a pull request" : null }, forceInCommitArea: true };
  }
  return { step: base, forceInCommitArea: false };
}

/** Push choices never wait on the linked pull request: they stay after it has merged. */
export const pushStaysAvailable = (_pr: Pr | null, s: Status | null): boolean => s !== null && s.branch !== null && s.upstream !== null && s.ahead > 0;

/** The readiness answer a Create PR check gave, tied to the ticket it was asked under. */
export type Readiness = { ticket: number; ok: boolean };
/** Create PR is enabled only by the answer to the newest check; an older yes never enables it. */
export const createEnabled = (newestTicket: number, answer: Readiness | null): boolean => answer !== null && answer.ticket === newestTicket && answer.ok;

/** While a push or sync picked from the dropdown runs and the main button reads Commit, the spinner is on the dropdown arrow. */
export function spinnerOn(running: RemoteAction | "commit" | null, step: Step): "main" | "arrow" | null {
  if (running === null) return null;
  const mainRuns = running === "commit" ? step.action === "commit" : step.action === running;
  if (mainRuns) return "main";
  return step.action === "commit" && running !== "commit" ? "arrow" : null;
}

/** After choosing Create pull request, the flow carries through commit and push before the composer. */
export function createFlow(s: Status | null, message: string): ("commit" | "push" | "composer")[] {
  if (s === null) return [];
  const out: ("commit" | "push" | "composer")[] = [];
  if (s.staged.length > 0 || s.changed.length > 0 || s.untracked.length > 0) {
    if (message.trim() === "") return [];
    out.push("commit");
  }
  if (out.length > 0 || s.upstream === null || s.ahead > 0) out.push("push");
  out.push("composer");
  return out;
}

// ---- VIEW-070: pull request from the sidebar --------------------------------------------------

export type StackPr = { number: number; head: string; base: string; state: string };
/** The stack map: pull requests ordered from the one on the trunk upward, each resting on the one before. An empty list when they do not form a single chain. */
export function stackMap(prs: StackPr[], trunk: string): StackPr[] {
  const byBase = new Map<string, StackPr[]>();
  for (const p of prs) byBase.set(p.base, [...(byBase.get(p.base) ?? []), p]);
  const chain: StackPr[] = [];
  let at = trunk;
  while (chain.length <= prs.length) {
    const next = byBase.get(at) ?? [];
    if (next.length === 0) break;
    if (next.length > 1) return [];
    chain.push(next[0]);
    at = next[0].head;
  }
  return chain.length === prs.length ? chain : [];
}

/** The manual link to open a pull request on GitHub; a push to a fork names the fork owner with the branch. */
export function manualPrLink(host: string, repo: { owner: string; name: string }, base: string, branch: string, forkOwner: string | null): string {
  const head = forkOwner && forkOwner !== repo.owner ? `${forkOwner}:${branch}` : branch;
  return `https://${host}/${repo.owner}/${repo.name}/compare/${encodeURIComponent(base)}...${head.split(":").map(encodeURIComponent).join(":")}?expand=1`;
}

/** The setting that hides every Source Control AI action; the generate controls follow it. */
export const SCM_AI_HIDDEN_KEY = "scmAiHidden";
export const aiControlsShown = (settings: Record<string, unknown> | null): boolean => settings?.[SCM_AI_HIDDEN_KEY] !== true;

/** Creating a pull request is blocked with a reason when local state is not ready (uncommitted changes first). */
export const createBlockedReason = (s: Status | null): string | null => {
  if (s === null) return "Loading";
  if (s.conflicts.length > 0) return "Resolve the conflicts first";
  if (s.staged.length + s.changed.length > 0) return "Commit your changes first";
  return null;
};
