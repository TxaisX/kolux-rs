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

/** What gh says when GitHub turned the sign-in down (a revoked or expired token, a logged-out gh), as
 *  against any other failure (offline, a timeout, gh could not run), which says nothing about the token. */
const REJECTED = /\b40[13]\b|bad credentials|requires authentication|gh auth login|not logged in|sign in to github|token/i;

/** One look at GitHub. `offline` is true when the budget call failed for a reason other than the sign-in
 *  being turned down: the answer is then "could not tell", which a caller may cover with an earlier one. */
async function look(call: Call): Promise<{ seen: Seen; offline: boolean }> {
  const account = await call<string | null>("scm_gh_account", { host: "github.com" }).catch(() => null);
  if (!account) return { seen: { account: null, token: "pending", tracker: "pending" }, offline: false };
  let said = "";
  const rows = await call<Row[]>("scm_gh_budget").catch((e) => ((said = String(e instanceof Error ? e.message : e)), null));
  if (!rows || rows.length === 0) return { seen: { account, token: "failed", tracker: "failed" }, offline: !rows && !REJECTED.test(said) };
  // The Rust side names the budgets REST, Search and GraphQL.
  return { seen: { account, token: "ok", tracker: rows.some((r) => r.name.toLowerCase() === "search") ? "ok" : "failed" }, offline: false };
}

/** Reads GitHub: the account first (cheap, from gh's config), then its API budget, which needs the token to work. */
export async function readSeen(call: Call): Promise<Seen> {
  return (await look(call)).seen;
}

/** How long a read of GitHub is trusted before gh is asked again. */
export const SEEN_FRESH_MS = 60_000;

/** FIX-1: `readSeen` with a memory. A read is answered from memory for a minute, so opening the guide, focusing
 *  the window or adding a project does not start gh (and a network round trip) every time. When a later read fails
 *  on the network the last good answer for the same account stands, so the sidebar ring does not dip while offline.
 *  A token GitHub turns down, a different account or a sign-out is never covered up. `force` (the Re-check button)
 *  always asks again and reports what it finds, but a good answer it gets is remembered. */
export function createSeenReader(now: () => number = Date.now) {
  let kept: { at: number; seen: Seen } | null = null;
  return async (call: Call, opts: { force?: boolean } = {}): Promise<Seen> => {
    if (!opts.force && kept && now() - kept.at < SEEN_FRESH_MS) return kept.seen;
    const { seen, offline } = await look(call);
    if (offline && !opts.force && kept?.seen.token === "ok" && kept.seen.account === seen.account) {
      kept = { at: now(), seen: kept.seen };
      return kept.seen;
    }
    kept = offline ? null : { at: now(), seen };
    return seen;
  };
}

/** The window's one remembered read. */
export const readSeenCached = createSeenReader();

/** FIX-1: whether tasks and pull requests can come from GitHub, by the same rule as the Connect integrations
 *  step (the sign-in is accepted and the task search answered); null while nothing has been read. */
export const taskSourceOf = (s: Seen | null): boolean | null => (s ? integrationSteps(s).tasks === "done" : null);
