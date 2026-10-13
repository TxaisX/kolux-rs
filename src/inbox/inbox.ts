// The Inbox (STAT-050): what needs you, what is waiting on an agent and what finished today,
// built from what the window already knows about its panes; and the arrow-key walk over the
// three groups. Pure, tested on its own.

import type { AgentState } from "../projects/rows";

export type Group = "needs" | "waiting" | "done";
export type Source = { key: number; agent: string; title: string; branch: string | null; cwd: string | null; state: AgentState; interrupted: boolean; running: boolean; changed: number; finishedAt: number | null };
export type Item = Omit<Source, "finishedAt" | "running" | "interrupted" | "changed"> & { group: Group; label: string; when: number };

export const GROUPS: Array<{ id: Group; title: string }> = [
  { id: "needs", title: "Needs you" },
  { id: "waiting", title: "Waiting on agent" },
  { id: "done", title: "Done today" },
];
/** Done today keeps the 20 newest finishes of the last 30 minutes. */
export const DONE_LIMIT = 20;
export const DONE_WINDOW_MS = 30 * 60_000;

/** Prompts that ask for approval are permissions, the rest questions (STAT-050). */
const NEEDS: Partial<Record<AgentState, string>> = { permission: "Permission", waiting: "Question", blocked: "Blocked" };

export function inboxItems(sources: Source[], now: number): Item[] {
  const item = (s: Source, group: Group, label: string, when: number): Item => ({ key: s.key, agent: s.agent, title: s.title, branch: s.branch, cwd: s.cwd, state: s.state, group, label, when });
  const newest = (a: Item, b: Item) => b.when - a.when;
  const needs = sources.filter((s) => NEEDS[s.state]).map((s) => item(s, "needs", NEEDS[s.state]!, s.changed));
  const waiting = sources.filter((s) => s.running && (s.state === "working" || s.state === "queued")).map((s) => item(s, "waiting", s.state === "queued" ? "Queued" : "Running", s.changed));
  // Interrupted sessions and anything older than 30 minutes stay out of done today.
  const done = sources
    .filter((s) => s.state === "done" && !s.interrupted && s.finishedAt !== null && now - s.finishedAt <= DONE_WINDOW_MS)
    .map((s) => item(s, "done", "Done", s.finishedAt!));
  return [...needs.sort(newest), ...waiting.sort(newest), ...done.sort(newest).slice(0, DONE_LIMIT)];
}

/** Up and Down walk the rows in order; with nothing selected Down picks the first and Up the last; both ends stop. */
export function moveSelection(keys: number[], selected: number | null, dir: 1 | -1): number | null {
  if (keys.length === 0) return null;
  const i = selected === null ? -1 : keys.indexOf(selected);
  if (i < 0) return dir > 0 ? keys[0] : keys[keys.length - 1];
  return keys[Math.min(Math.max(i + dir, 0), keys.length - 1)];
}

/** A selection whose row disappeared goes back to the first row. */
export function settle(keys: number[], selected: number | null): number | null {
  if (selected === null) return null;
  return keys.includes(selected) ? selected : (keys[0] ?? null);
}

/** EDIT-041: the detail's button. Nothing is answered in the Inbox itself yet, so a question or a
 *  permission always sends the user to the agent's pane to answer it there. */
export function openLabel(item: Pick<Item, "group">): "Answer in Code" | "Open in Code" {
  return item.group === "needs" ? "Answer in Code" : "Open in Code";
}
