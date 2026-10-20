// SESS-033 (T-187-b): the fix action beside failing pull-request checks starts an agent session in that
// worktree with the failing checks as its task. Nothing starts when the worktree is gone, no agent is
// switched on, or the saved arguments are invalid (the launch rejects); each says why.
import type { Check } from "../scm/checks";
import { checkGroups } from "../scm/review";
import { NO_AGENT, pickSaved, startChecked, type Launch, type StartAgent, type StartResult } from "./rules";

/** The checks the fix action is about: failed ones and ones that finished without an outcome. */
export const failingChecks = (checks: Check[]): Check[] => checkGroups(checks).failing;

/** How many checks one prompt names; the rest are counted. */
export const FIX_LIST_MAX = 20;

/** The agent's task: each failing check with its workflow, what it said and where to read its output. */
export function fixChecksPrompt(pr: { number: number; title?: string | null; url: string }, failing: Check[]): string {
  const shown = failing.slice(0, FIX_LIST_MAX);
  const rows = shown.map((c) => {
    const bits = [c.workflow ? `workflow ${c.workflow}` : null, c.outcome === "unresolved" ? "finished without reporting an outcome" : null, c.description ? c.description.replace(/\s+/g, " ").trim().slice(0, 300) : null, c.link ? `details: ${c.link}` : null].filter(Boolean);
    return `- ${c.name}${bits.length ? ` (${bits.join("; ")})` : ""}`;
  });
  const more = failing.length > shown.length ? `\n- and ${failing.length - shown.length} more failing checks (read the pull request's checks for the full list)` : "";
  return `Pull request #${pr.number}${pr.title ? ` "${pr.title}"` : ""} (${pr.url}) has ${failing.length === 1 ? "a failing check" : `${failing.length} failing checks`}:\n${rows.join("\n")}${more}\n\nFind the cause of each failure in this repository, fix it, and run the same checks locally where you can. Do not change a check to make it pass. Say what you changed and what you could not reproduce.`;
}

export type FixRun = {
  dir: string | null;
  pr: { number: number; title?: string | null; url: string } | null;
  checks: Check[];
  agents: StartAgent[];
  /** The agent saved for agent actions (the same choice Source Control's agent actions use). */
  saved: unknown;
  defaultId: string;
  ready: (dir: string) => Promise<void>;
  launch: Launch;
};

/** Starts an agent on the failing checks. Never launches when there is no folder, no failing check or
 *  no agent; the result says which step stopped. */
export async function runFixChecks(o: FixRun): Promise<StartResult> {
  if (!o.dir) return { ok: false, stage: "folder", message: "Open a workspace first, so there is a folder to start the agent in." };
  if (!o.pr) return { ok: false, stage: "workspace", message: "This branch has no pull request, so there are no checks to fix." };
  const failing = failingChecks(o.checks);
  if (failing.length === 0) return { ok: false, stage: "workspace", message: "No check is failing on this pull request." };
  const agent = pickSaved(o.agents, o.saved, o.defaultId);
  if (!agent) return { ok: false, stage: "agent", message: NO_AGENT };
  return startChecked({ agent, dir: o.dir, prompt: fixChecksPrompt(o.pr, failing), what: "the failing checks", ready: o.ready, launch: o.launch });
}
