// VIEW-073: the Checks panel's pure parts: the summary line, whether to keep polling, and the
// short grace period that reuses a recent "no pull request" answer.
import type { Pr } from "./model";

export type Check = { name: string; outcome: "passed" | "failed" | "running" | "skipped" | "cancelled" | "unresolved" | "neutral"; workflow?: string | null; link?: string | null; started?: string | null; finished?: string | null; description?: string | null };
export type PrChecks = { pr: Pr | null; conflict: boolean; checks: Check[] };

/** How often running checks are asked about again while the panel is in view. */
export const CHECKS_POLL_MS = 15_000;
/** How long a "no pull request" answer for a worktree is trusted before gh is asked again. */
export const NO_PR_GRACE_MS = 60_000;

const ORDER: Check["outcome"][] = ["failed", "unresolved", "running", "cancelled", "skipped", "neutral", "passed"];

export function checksSummary(checks: Check[]): string {
  if (checks.length === 0) return "No checks have reported on this pull request.";
  return ORDER.map((o) => [o, checks.filter((c) => c.outcome === o).length] as const)
    .filter(([, n]) => n > 0)
    .map(([o, n]) => `${n} ${o}`)
    .join(" · ");
}

export const stillRunning = (checks: Check[]): boolean => checks.some((c) => c.outcome === "running");

export const reuseNoPr = (seen: Map<string, number>, dir: string, now: number): boolean => {
  const at = seen.get(dir);
  return at !== undefined && now - at < NO_PR_GRACE_MS;
};
