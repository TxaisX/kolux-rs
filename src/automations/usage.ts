// AUTO-014: a finished run's tokens and spend, matched from the token usage Kolux already reads
// from the agents' own local logs (USAGE-012). Pure functions, so the matching rules are tested
// without a window. A figure is shown only when it can be tied to the run: the agent session
// recorded on the run, or else the one session in the run's own new worktree between its start and
// shortly after its end. A folder the run shares (an existing worktree, where the user may be
// working in the same folder) or a window holding more than one session reads unavailable rather
// than billing someone else's work to the run. An unknown cost reads unavailable, never $0, and an
// agent that keeps no local usage record is marked unsupported.
import { locale } from "../language";
import { estimate } from "../usage/pricing";
import { PROVIDERS, tokensOf, type Provider, type Usage } from "../usage/tokens";
import type { Automation, Run } from "./model";

/** How long after a run ends its agent's last reply may still land in its log. */
export const SETTLE_MS = 60_000;

export type RunUsage =
  | { kind: "unsupported"; agent: string }
  | { kind: "unavailable"; why: string }
  | { kind: "matched"; tokens: number; usd: number | null; unpriced: string[] };

const isProvider = (p: string | undefined): p is Provider => PROVIDERS.includes(p as Provider);

/** One folder however it is spelled: separators, a trailing slash, and case on a drive path. */
export const sameFolder = (a: string, b: string) => {
  const norm = (s: string) => {
    const t = s.replace(/\\/g, "/").replace(/\/+$/, "");
    return /^[a-z]:/i.test(t) ? t.toLowerCase() : t;
  };
  return norm(a) === norm(b);
};

/** The usage of one run, or null for a run that has none to show (still going, skipped, never handed
 * to an agent). `agentName` is the agent's display name for the unsupported line; `mode` is the
 * automation's workspace mode (missing, as for a deleted automation, counts as a shared folder). */
export function runUsage(run: Run, usage: Usage | null, agentName?: string, mode?: Automation["workspaceMode"]): RunUsage | null {
  if ((run.status !== "completed" && run.status !== "failed") || !run.worktree || !run.dispatchedAt) return null;
  const p = run.provider;
  if (!isProvider(p)) return { kind: "unsupported", agent: agentName ?? p ?? "This agent" };
  if (!usage) return { kind: "unavailable", why: "token usage could not be read" };
  if (!usage.tracking[p]) return { kind: "unavailable", why: "token tracking is off for this agent" };
  const saved = usage[p];
  if (!saved) return { kind: "unavailable", why: "this agent's usage has not been read yet" };
  const from = run.dispatchedAt;
  const to = (run.finishedAt ?? run.dispatchedAt) + SETTLE_MS;
  let rows;
  if (run.sessionId) {
    rows = saved.rows.filter((r) => r.session === run.sessionId && r.last >= from);
  } else {
    if (mode !== "new-per-run") return { kind: "unavailable", why: "the run shares its folder with other sessions, and its own session was not recorded" };
    rows = saved.rows.filter((r) => r.last >= from && r.last <= to && sameFolder(r.cwd, run.worktree!));
    if (new Set(rows.map((r) => r.session)).size > 1) return { kind: "unavailable", why: "more than one session used the run's folder while it ran" };
  }
  if (rows.length === 0) return { kind: "unavailable", why: "no usage could be matched to this run" };
  const e = estimate(p, rows);
  return { kind: "matched", tokens: rows.reduce((n, r) => n + tokensOf(r), 0), usd: e.unpriced.length ? null : e.usd, unpriced: e.unpriced };
}

export const tokensWord = (n: number) => `${n.toLocaleString(locale())} tokens`;
export const usdWord = (usd: number) => (usd > 0 && usd < 0.01 ? "under $0.01" : `$${usd.toFixed(2)}`);

export function usageWord(u: RunUsage): string {
  if (u.kind === "unsupported") return `Not supported: ${u.agent} keeps no local usage record`;
  if (u.kind === "unavailable") return `Unavailable: ${u.why}`;
  return `${tokensWord(u.tokens)} · ${u.usd === null ? `cost unavailable (no price for ${u.unpriced.join(", ")})` : usdWord(u.usd)}`;
}

/** The automation's row: usage added up across its runs. Cost is a sum only when every matched run
 * has a known cost; one unknown makes the total unavailable rather than too low. */
export function totalUsage(runs: Run[], usage: Usage | null, agentName?: string, mode?: Automation["workspaceMode"]): string {
  const each = runs.map((r) => runUsage(r, usage, agentName, mode)).filter((u): u is RunUsage => u !== null);
  const unsupported = each.find((u) => u.kind === "unsupported");
  const matched = each.filter((u): u is Extract<RunUsage, { kind: "matched" }> => u.kind === "matched");
  if (matched.length === 0) {
    if (unsupported) return usageWord(unsupported);
    return each.length === 0 ? "Not recorded yet: no run has finished" : "Unavailable: no usage could be matched to its runs";
  }
  const tokens = matched.reduce((n, u) => n + u.tokens, 0);
  const usd = matched.some((u) => u.usd === null) ? null : matched.reduce((n, u) => n + (u.usd ?? 0), 0);
  const runsWord = `${matched.length} run${matched.length === 1 ? "" : "s"}`;
  return `${tokensWord(tokens)} over ${runsWord} · ${usd === null ? "cost unavailable" : usdWord(usd)}`;
}
