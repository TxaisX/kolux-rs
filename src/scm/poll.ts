// GIT-027 / GIT-028: the background pull request poll behind every workspace row. Rust asks gh
// once per GitHub project (scm_prs_poll); this file orders the workspaces, keeps what was known
// when a lookup fails, and spaces the rounds out.
import type { PrState } from "../projects/rows";
import type { Pr } from "./model";

export type PolledPr = { path: string; linked: boolean; pr: Pr | null; error: string | null };
export type PrPoll = { prs: PolledPr[]; limitedUntil: number | null };

/** A round every three minutes while the window is shown; a failing one doubles up to 30 minutes. */
export const POLL_MS = 3 * 60_000;
const MAX_MS = 30 * 60_000;
/** Data older than this is read again when the window gains focus. */
export const STALE_MS = 60_000;

/** The workspaces to look up, the visible one first, each once; a hand-linked PR replaces the branch's. */
export function pollItems(paths: string[], activeDir: string | null, linked: Record<string, string>): { path: string; linked: string | null }[] {
  const order = [...new Set(activeDir !== null && paths.includes(activeDir) ? [activeDir, ...paths] : paths)];
  return order.map((path) => ({ path, linked: linked[path] ?? null }));
}

/** The sidebar's pull request state for a row (PROJ-045 groups). */
export function rowPr(pr: Pr | null): PrState {
  if (!pr) return null;
  if (pr.state === "MERGED") return "merged";
  if (pr.state === "CLOSED") return "closed";
  return pr.draft ? "draft" : "open";
}

/** A round's answers over what was known; a workspace whose lookup failed keeps its last state. */
export function mergePoll(prev: Record<string, PrState>, poll: PrPoll): Record<string, PrState> {
  const next = { ...prev };
  for (const p of poll.prs) if (p.error === null) next[p.path] = rowPr(p.pr);
  return next;
}

/** How long until the next round: the reset time after a rate limit (plus 5 s), else backoff. */
export function nextDelay(failures: number, limitedUntil: number | null, now: number): number {
  if (limitedUntil !== null && limitedUntil * 1000 > now) return limitedUntil * 1000 - now + 5000;
  return Math.min(MAX_MS, POLL_MS * 2 ** Math.min(failures, 8));
}
