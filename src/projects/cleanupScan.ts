// PROJ-080: the cleanup dialog's scan and rules. One scan runs at a time (a second open joins
// it), the last result is kept so the dialog shows it at once while a new scan runs, and what the
// user chose (every workspace or only quiet ones, ticks changed by hand) outlives the dialog.
import { ago } from "../automations/model";
import type { Project, Worktree } from "./model";

/** One workspace with plain facts; null where the read failed or its repository ran out of time. */
export type CleanupRow = Worktree & { locked?: string | null; changes: number | null; lastCommit: number | null; merged: boolean | null };
export type RepoScan = { project: Project; rows: CleanupRow[]; error?: string };
export type CleanupScan = { at: number; repos: RepoScan[] };

/** No commit for this long and a workspace has gone quiet. */
export const QUIET_MS = 7 * 24 * 3600 * 1000;

export const isQuiet = (r: CleanupRow, now: number) => r.lastCommit !== null && now - r.lastCommit >= QUIET_MS;

/** Clean, quiet and not locked: ticked from the start. */
export const preselected = (r: CleanupRow, now: number) => r.changes === 0 && !r.locked && r.locked !== "" && isQuiet(r, now);

/** Only quiet or merged workspaces are listed, unless every workspace is asked for. */
export const listed = (r: CleanupRow, now: number, every: boolean) => every || isQuiet(r, now) || r.merged === true;

/** What a row says before it is opened: facts, never verdicts. */
export function facts(r: CleanupRow, now: number): string[] {
  const out = [r.changes === null ? "changes unknown" : r.changes === 0 ? "clean" : `${r.changes} change${r.changes === 1 ? "" : "s"}`];
  out.push(r.lastCommit === null ? "last commit unknown" : `last commit ${ago(r.lastCommit, now)}`);
  out.push(r.merged === null ? "Git state unknown" : r.merged ? "no commits beyond the default branch" : "has commits of its own");
  if (r.locked !== undefined && r.locked !== null) out.push(r.locked ? `locked: ${r.locked}` : "locked");
  return out;
}

/** What the user chose, kept across opens. */
export const kept = { every: false, ticks: new Map<string, boolean>() };
export const ticked = (r: CleanupRow, now: number) => kept.ticks.get(r.path) ?? preselected(r, now);

let running: Promise<CleanupScan> | null = null;
let progressTo: ((done: number, total: number) => void) | null = null;
export let lastScan: CleanupScan | null = null;

/** Scans every project at once, one call each; a call made while a scan runs joins it. */
export function scanCleanup(projects: Project[], scanOne: (projectId: string) => Promise<CleanupRow[]>, onProgress: (done: number, total: number) => void): Promise<CleanupScan> {
  progressTo = onProgress;
  if (running) return running;
  let done = 0;
  running = Promise.all(
    projects.map(async (project): Promise<RepoScan> => {
      const out = await scanOne(project.id).then(
        (rows) => ({ project, rows }),
        (e) => ({ project, rows: [], error: String(e) }),
      );
      progressTo?.(++done, projects.length);
      return out;
    }),
  )
    .then((repos) => (lastScan = { at: Date.now(), repos }))
    .finally(() => (running = null));
  return running;
}
