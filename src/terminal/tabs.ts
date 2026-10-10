// Tab badges (TERM-055) and the unread rule for a finish or a bell (TERM-118). Pure, tested on
// its own. ponytail: the permission badge is fed by `needs`, which the status hooks fill (T-025).

import type { AgentState } from "../projects/rows";

export type Badge = "working" | "permission" | "unread" | "done" | null;

/**
 * The one badge a tab shows: a working agent spins, one waiting on the user shows the question
 * mark, an unvisited finish (or bell) keeps the bell, a visited finish the check. An idle shell
 * shows only its identity icon.
 */
export function tabBadge(agent: string, running: boolean | undefined, needs: boolean, unread: boolean, hook?: AgentState): Badge {
  if (agent === "shell") return unread ? "unread" : null;
  if (running !== false) {
    if (needs) return "permission";
    // STAT-001: the hook says the turn is over while the program still runs.
    if (hook === "done") return unread ? "unread" : "done";
    return "working";
  }
  return unread ? "unread" : "done";
}

/**
 * Whether a finish or bell on pane `key` marks it unread: not for the pane in view in a focused
 * window; a hidden tab, a hidden split pane or a window in the background is marked. A late event
 * for a pane that is gone or already marked is dropped.
 */
export function marksUnread(key: number, known: Set<number>, marked: Set<number>, inView: boolean, windowFocused: boolean): boolean {
  if (!known.has(key) || marked.has(key)) return false;
  return !(inView && windowFocused);
}
