// The Automations list (AUTO-016) as pure functions: rows, sorting, filters and search, so the
// rules are tested without a window. The rows come from the back end (src-tauri/src/automations.rs).

export type Trigger = { kind: "schedule"; cron?: string; timezone?: string } | { kind: "event"; event: "pr-opened" | "checks-failed" | "agent-finished" };

export type Automation = {
  id: string;
  name: string;
  prompt: string;
  provider: string;
  projectId: string;
  workspaceMode?: "existing" | "new-per-run";
  workspace?: string | null;
  trigger?: Trigger;
  enabled: boolean;
  /** When the clock will start it next (T-085 fills it in); milliseconds since 1970. */
  nextRunAt?: number | null;
};

/** AUTO-012's states; `cause` says why a run was skipped. */
export type RunStatus = "pending" | "dispatching" | "dispatched" | "completed" | "skipped" | "failed";
export type Run = { id: string; automationId: string; number: number; trigger: "manual" | "schedule" | "event"; status: RunStatus; at: number; cause?: string; detail?: string; worktree?: string; worktreeName?: string };

export type SortKey = "name" | "trigger" | "agent" | "project" | "lastRun" | "nextRun";
export type Filters = { state: "all" | "on" | "paused"; result: "all" | "never" | RunStatus; agents: string[] };
export const noFilters: Filters = { state: "all", result: "all", agents: [] };

/** Search looks at this much of a prompt (AUTO-016). */
export const PROMPT_SEARCH_CHARS = 2048;
/** A query longer than this is refused rather than run. */
export const MAX_QUERY = 200;

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
/** Names sort the way people count: "Run 2" before "Run 10", case ignored. */
export const naturalCompare = (a: string, b: string): number => collator.compare(a, b);

/** The newest run of an automation, or none when it never ran. */
export function lastRun(id: string, runs: Run[]): Run | undefined {
  let best: Run | undefined;
  for (const r of runs) if (r.automationId === id && (!best || r.at > best.at || (r.at === best.at && r.number > best.number))) best = r;
  return best;
}

/** One case, single spaces, no ends; null when the query is too long to take. */
export function normalizeQuery(q: string): string | null {
  const n = q.trim().replace(/\s+/g, " ").toLowerCase();
  return n.length > MAX_QUERY ? null : n;
}

export type Names = { project: (id: string) => string; agent: (id: string) => string };

/** Name, project, worktree, agent and the first 2,048 characters of the prompt. */
export function matches(a: Automation, q: string, names: Names): boolean {
  if (q === "") return true;
  const hay = [a.name, names.project(a.projectId), a.workspace ?? "", a.workspace ? folderOf(a.workspace) : "", names.agent(a.provider), a.provider, a.prompt.slice(0, PROMPT_SEARCH_CHARS)].join("\n");
  return hay.replace(/[ \t]+/g, " ").toLowerCase().includes(q);
}

export function folderOf(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function passes(a: Automation, f: Filters, runs: Run[]): boolean {
  if (f.state === "on" && !a.enabled) return false;
  if (f.state === "paused" && a.enabled) return false;
  if (f.agents.length > 0 && !f.agents.includes(a.provider)) return false;
  if (f.result !== "all") {
    const last = lastRun(a.id, runs);
    if (f.result === "never" ? last !== undefined : last?.status !== f.result) return false;
  }
  return true;
}

/** Sorted rows. By last run: newest first, and automations that never ran always go last. */
export function sortRows(list: Automation[], runs: Run[], key: SortKey, desc: boolean, names: Names): Automation[] {
  const text = (a: Automation): string => (key === "agent" ? names.agent(a.provider) : key === "project" ? names.project(a.projectId) : key === "trigger" ? triggerLabel(a) : a.name);
  return [...list].sort((x, y) => {
    if (key === "lastRun" || key === "nextRun") {
      const vx = key === "lastRun" ? lastRun(x.id, runs)?.at : (x.enabled ? x.nextRunAt : null) ?? undefined;
      const vy = key === "lastRun" ? lastRun(y.id, runs)?.at : (y.enabled ? y.nextRunAt : null) ?? undefined;
      if (vx === undefined || vy === undefined) return vx === vy ? naturalCompare(x.name, y.name) : vx === undefined ? 1 : -1;
      // Last run reads newest first by default; next run soonest first.
      const order = key === "lastRun" ? vy - vx : vx - vy;
      return (desc ? -order : order) || naturalCompare(x.name, y.name);
    }
    const order = naturalCompare(text(x), text(y)) || naturalCompare(x.name, y.name);
    return desc ? -order : order;
  });
}

const events: Record<string, string> = { "pr-opened": "When a pull request opens", "checks-failed": "When checks fail", "agent-finished": "When an agent finishes" };
const presets: Record<string, string> = { "0 * * * *": "Every hour", "0 9 * * *": "Every day at 09:00", "0 9 * * 1-5": "Weekdays at 09:00", "0 9 * * 1": "Mondays at 09:00" };

/** The timetable or trigger in a few words. ponytail: AUTO-001's full friendly sentence is T-085. */
export function triggerLabel(a: Automation): string {
  const t = a.trigger;
  if (!t) return "No timetable";
  if (t.kind === "event") return events[t.event] ?? "On an event";
  const cron = (t.cron ?? "").trim().replace(/\s+/g, " ");
  return presets[cron] ?? (cron ? `Custom: ${cron}` : "No timetable");
}

export function statusWord(r: Run): string {
  switch (r.status) {
    case "pending":
      return "Queued";
    case "dispatching":
      return "Starting";
    case "dispatched":
      return "Running";
    case "completed":
      return "Completed";
    case "skipped":
      return r.cause ? `Skipped (${r.cause})` : "Skipped";
    case "failed":
      return "Failed to start";
  }
}

export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function upcoming(a: Automation, now: number): string {
  if (!a.enabled) return "Paused";
  if (a.trigger?.kind === "event") return "On the next event";
  if (!a.nextRunAt) return "Not scheduled";
  const mins = Math.max(0, Math.round((a.nextRunAt - now) / 60000));
  if (mins < 60) return `in ${mins} min`;
  const h = Math.round(mins / 60);
  return h < 48 ? `in ${h} h` : `in ${Math.round(h / 24)} days`;
}

/** The delete confirmation is on out of the box (AUTO-019); settings can switch it off. */
export const CONFIRM_DELETE_KEY = "confirmAutomationDelete";
export const confirmDelete = (settings: Record<string, unknown>): boolean => settings[CONFIRM_DELETE_KEY] !== false;
