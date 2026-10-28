// VIEW-073: the Checks panel's pure parts: the summary line, whether to keep polling, and the
// short grace period that reuses a recent "no pull request" answer.
import type { Pr } from "./model";

export type Check = { name: string; outcome: "passed" | "failed" | "running" | "skipped" | "cancelled" | "unresolved" | "neutral"; workflow?: string | null; link?: string | null; started?: string | null; finished?: string | null; description?: string | null };
/** `provider`/`host` are sent only for a remote that is not GitHub (row 76): gh was not asked, and the answer is "no pull request". */
export type PrChecks = { pr: Pr | null; conflict: boolean; checks: Check[]; provider?: string; host?: string | null };

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

/** VIEW-073: a pull request the host itself reports as unlinked is never shown. */
export const hostUnlinked = (pr: Pr | null | undefined): boolean => !!pr && pr.state.toLowerCase() === "unlinked";

/** VIEW-073: the settings key of the pull requests the user unlinked in the Checks tab, by worktree. */
export const CHECKS_UNLINKED_KEY = "checksUnlinkedPrs";
export type Unlinked = { number: number; url: string };

/** The saved unlinked pull requests, keeping only well-formed entries. */
export const unlinkedPrs = (v: unknown): Record<string, Unlinked> => {
  const out: Record<string, Unlinked> = {};
  if (v === null || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [dir, e] of Object.entries(v)) {
    const o = e as Partial<Unlinked> | null;
    if (o && typeof o.number === "number" && typeof o.url === "string") out[dir] = { number: o.number, url: o.url };
  }
  return out;
};

/** The map with one worktree's unlinked pull request set, or cleared when `pr` is null. */
export const withUnlinkedPr = (map: Record<string, Unlinked>, dir: string, pr: Unlinked | null): Record<string, Unlinked> => {
  const next = { ...map };
  if (pr === null) delete next[dir];
  else next[dir] = pr;
  return next;
};

/** What the Checks tab shows for an answer: the pull request, nothing (no review: a create action may be
 *  offered), or a notice naming a pull request the user unlinked, with a button to link it again and no
 *  create action meanwhile. An older answer never stands in: the notice names only the pull request the
 *  lookup returned, and a different pull request on the branch shows as usual. */
export type Showing = { kind: "pr"; pr: Pr } | { kind: "none" } | { kind: "unlinked"; pr: Unlinked };
export function showing(pr: Pr | null | undefined, unlinked: Unlinked | undefined): Showing {
  if (!pr || hostUnlinked(pr)) return { kind: "none" };
  if (unlinked && unlinked.number === pr.number) return { kind: "unlinked", pr: unlinked };
  return { kind: "pr", pr };
}

export type PanelBody = "workspace" | "error" | "looking" | "unlinked" | "start" | "review";
/** Row 76: which body the Checks panel draws. A non-GitHub remote answers without an error and without a pull request, so it is
 *  "start": the composer, which says the lookup is not available there, never the gh sign-in banner an error would bring. */
export function panelBody(p: { dir: string | null; error: string | null; data: PrChecks | null; view: Showing["kind"] | null }): PanelBody {
  if (p.dir === null) return "workspace";
  if (p.error) return "error";
  if (!p.data) return "looking";
  if (p.view === "unlinked") return "unlinked";
  return p.view === "pr" ? "review" : "start";
}
