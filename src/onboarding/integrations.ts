// ONB-018: the Connect integrations step. A review step (GitHub signed in and its token accepted)
// and a task-source step that waits behind it. The rebuild keeps GitHub only (ONB-019 dropped the
// other providers). Pure rules, so they are tested without a browser; IntegrationsPanel (in
// StepPanels.tsx) draws them.
/** One check's standing. "stale" is an answer from before the latest Re-check began: it is not trusted. */
export type Check = "pending" | "ok" | "failed" | "stale";
/** What was seen of GitHub: the account gh is signed in as (from gh's own config, no network), whether
 *  its token was accepted (a call to the API) and whether the tracker (the search budget) answered. */
export type Seen = { account: string | null; token: Check; tracker: Check };
export const UNSEEN: Seen = { account: null, token: "pending", tracker: "pending" };

export type IntState = "active" | "waiting" | "done";
export type Steps = { review: IntState; tasks: IntState; source: string | null; reviewNote: string | null; tasksNote: string | null };

/** ONB-018: the review step is active first; the task step waits (folded, but openable). A cached sign-in
 *  is not connected while its token check is stale, pending or failed, and a failed token sign-in does
 *  not count as ready for review. A connected code host completes the task step only once review is
 *  connected and the tracker checks have finished; then the step folds into a summary naming the source. */
export function integrationSteps(s: Seen): Steps {
  const review: IntState = s.account && s.token === "ok" ? "done" : "active";
  const reviewNote =
    review === "done"
      ? null
      : !s.account
        ? "GitHub is not connected. Run gh auth login in a terminal, then check again."
        : s.token === "failed"
          ? "GitHub did not accept the sign-in. Run gh auth login again, then check again."
          : "Checking the GitHub sign-in...";
  if (review !== "done") return { review, tasks: "waiting", source: null, reviewNote, tasksNote: null };
  if (s.tracker === "ok") return { review, tasks: "done", source: "GitHub", reviewNote, tasksNote: null };
  return {
    review,
    tasks: "active",
    source: null,
    reviewNote,
    tasksNote: s.tracker === "failed" ? "GitHub's task search did not answer. Check again in a moment." : "Checking GitHub's task search...",
  };
}

/** The summary the folded task step shows. */
export const taskSummary = (s: Steps, account: string | null): string | null =>
  s.source ? `Tasks come from ${s.source}${account ? ` (${account})` : ""}` : null;

/** Re-check begins: every answer so far is stale until the new one lands. */
export const restale = (s: Seen): Seen => ({
  account: s.account,
  token: s.token === "pending" ? "pending" : "stale",
  tracker: s.tracker === "pending" ? "pending" : "stale",
});

type Call = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
export type Row = { name: string };

/** Reads GitHub: the account first (cheap, from gh's config), then its API budget, which needs the token to work. */
export async function readSeen(call: Call): Promise<Seen> {
  const account = await call<string | null>("scm_gh_account", { host: "github.com" }).catch(() => null);
  if (!account) return { account: null, token: "pending", tracker: "pending" };
  const rows = await call<Row[]>("scm_gh_budget").catch(() => null);
  if (!rows || rows.length === 0) return { account, token: "failed", tracker: "failed" };
  return { account, token: "ok", tracker: rows.some((r) => r.name === "search") ? "ok" : "failed" };
}
