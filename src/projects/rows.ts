// What a sidebar row knows about its workspace beyond the worktree itself (PROJ-045, PROJ-050,
// PROJ-063): the strongest live agent state, when it last changed, and its pull request. Pure,
// so the ordering and grouping rules are tested on their own.
// ponytail: today the only live states are working / done / idle, read from whether an agent
// pane's program is up; permission, blocked, waiting and interrupted arrive with the status hooks
// (STAT-001, T-025), and the pull-request state with GIT-025 (T-229). The rules here take them already.

export type AgentState = "permission" | "blocked" | "waiting" | "interrupted" | "working" | "queued" | "done" | "idle";
export type PrState = "open" | "draft" | "merged" | "closed" | "suppressed" | null;
export type RowInfo = { state: AgentState; changed: number; pr: PrState };
export type GroupBy = "none" | "project" | "status" | "pr";
export type SortBy = "smart" | "name";

export const GROUP_SETTING = "workspaceGroupBy";
export const SORT_SETTING = "workspaceSort";

/** AUTO-024: the sidebar switch that hides worktrees made by automation runs. */
export const HIDE_AUTOMATION_SETTING = "hideAutomationWorktrees";

type Made = { path: string; madeBy?: string | null };

/** AUTO-024: each project's list without the worktrees automation runs made, while the switch is on. */
export function withoutAutomationMade<W extends Made>(lists: Record<string, W[]>, hide: boolean): Record<string, W[]> {
  if (!hide) return lists;
  return Object.fromEntries(Object.entries(lists).map(([id, ws]) => [id, ws.filter((w) => w.madeBy !== "automation")]));
}

/** AUTO-024: moving to a worktree the switch hides (View run, the palette) turns the switch off so it can be seen. */
export function jumpUnhides(prev: string | null, next: string | null, lists: Record<string, Made[]>, hide: boolean, same: (a: string, b: string) => boolean): boolean {
  if (!hide || next === null || (prev !== null && same(prev, next))) return false;
  return Object.values(lists).some((ws) => ws.some((w) => w.madeBy === "automation" && same(w.path, next)));
}

/** Strongest first: a permission request outranks everything. */
const RANK: AgentState[] = ["permission", "blocked", "waiting", "interrupted", "working", "queued", "done", "idle"];

export function strongest(states: AgentState[]): AgentState {
  return states.reduce<AgentState>((best, s) => (RANK.indexOf(s) < RANK.indexOf(best) ? s : best), "idle");
}

/** A pane's state from what the window knows: a shell is idle; an agent is working until its program ends. */
export function paneState(agent: string, running: boolean | undefined): AgentState {
  if (agent === "shell") return "idle";
  return running === false ? "done" : "working";
}

/** Smart classes (PROJ-050): what needs you, then finished, then working, then idle. An interrupted agent needs you; it is never done. */
export function smartClass(s: AgentState): number {
  if (s === "permission" || s === "blocked" || s === "waiting" || s === "interrupted") return 0;
  if (s === "done") return 1;
  if (s === "working" || s === "queued") return 2;
  return 3;
}

export function smartOrder<T>(rows: T[], info: (row: T) => RowInfo): T[] {
  return [...rows].sort((a, b) => {
    const [ia, ib] = [info(a), info(b)];
    return smartClass(ia.state) - smartClass(ib.state) || ib.changed - ia.changed;
  });
}

const STATUS_GROUPS = ["Needs you", "Working", "Queued", "Done", "Idle"];
const PR_GROUPS = ["In progress", "Done", "Closed", "No pull request"];

export function statusGroup(s: AgentState): string {
  if (s === "queued") return "Queued";
  return ["Needs you", "Done", "Working", "Idle"][smartClass(s)];
}

/** A merged pull request is done; a suppressed one still counts as in progress (PROJ-045). */
export function prGroup(pr: PrState): string {
  if (pr === "merged") return "Done";
  if (pr === "closed") return "Closed";
  if (pr === null) return "No pull request";
  return "In progress";
}

export function groupRows<T>(rows: T[], by: GroupBy, info: (row: T) => RowInfo, project: (row: T) => string): { title: string; rows: T[] }[] {
  if (by === "none") return [{ title: "", rows }];
  const titles = by === "status" ? STATUS_GROUPS : by === "pr" ? PR_GROUPS : [...new Set(rows.map(project))];
  const key = (r: T) => (by === "status" ? statusGroup(info(r).state) : by === "pr" ? prGroup(info(r).pr) : project(r));
  return titles.map((title) => ({ title, rows: rows.filter((r) => key(r) === title) })).filter((g) => g.rows.length > 0);
}

export function sortFromSetting(v: unknown): SortBy {
  return v === "name" ? "name" : "smart";
}

export function groupFromSetting(v: unknown): GroupBy {
  return v === "none" || v === "status" || v === "pr" ? v : "project";
}
