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
/** "activity" is PROJ-051's Recent; the old stored "recent" is PROJ-050's and moves to Smart once. */
export type SortBy = "smart" | "name" | "activity";

export const GROUP_SETTING = "workspaceGroupBy";
export const SORT_SETTING = "workspaceSort";
/** PROJ-046: the pinned workspaces' paths, and whether a pinned row also shows in its own group. */
export const PIN_SETTING = "pinnedWorkspaces";
export const PIN_COPIES_SETTING = "pinnedCopies";

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
  return v === "name" || v === "activity" ? v : "smart";
}

export function groupFromSetting(v: unknown): GroupBy {
  return v === "none" || v === "status" || v === "pr" ? v : "project";
}

/** One key per folder, however Git or Windows spelled it; the backend's activity map uses the same. */
export function pathKey(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** PROJ-051: latest activity first; rows never seen keep their order at the end. */
export function recentOrder<T>(rows: T[], stamp: (row: T) => number): T[] {
  return [...rows].sort((a, b) => stamp(b) - stamp(a));
}

/** PROJ-046: the pinned paths and every workspace made from them, at any depth, as path keys. */
export function pinnedSet(pins: string[], ws: { path: string; parent?: string | null }[]): Set<string> {
  const out = new Set(pins.map(pathKey));
  for (let grew = true; grew; ) {
    grew = false;
    for (const w of ws) {
      const k = pathKey(w.path);
      if (w.parent && !out.has(k) && out.has(pathKey(w.parent))) grew = !!out.add(k);
    }
  }
  return out;
}
