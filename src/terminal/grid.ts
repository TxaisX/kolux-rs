// The pane grid's arithmetic (TERM-001, TERM-004, TERM-006): how many panes a workspace may hold,
// how they tile, what a resize adds or drops, and where a split lands. Pure, so it is tested
// without a browser; the window applies the plan.
import { panesIn, type PaneLike } from "../workspaces";

/** TERM-001: a workspace holds 1..12 panes. */
export const MAX_PANES = 12;

export function clampCount(n: number): number {
  const whole = Math.floor(n);
  return Number.isFinite(whole) ? Math.max(1, Math.min(MAX_PANES, whole)) : 1;
}

/** TERM-004: columns for a pane count, so rows stay roughly even (1, 2, 2x2, 3x2, 3x3, 4x3). */
export function columnsFor(count: number): number {
  return count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
}

export function rowsFor(count: number): number {
  return Math.max(1, Math.ceil(count / columnsFor(count)));
}

/** TERM-001: growing adds empty panes; shrinking drops unstarted panes first, newest first, and
 * never a started session (TERM-003's "ask first" comes with its own task), so `drop` may fall
 * short of the request. */
export function resizePlan(shown: { key: number; started: boolean }[], n: number): { add: number; drop: number[] } {
  const want = clampCount(n);
  if (want >= shown.length) return { add: want - shown.length, drop: [] };
  const drop = shown
    .filter((p) => !p.started)
    .map((p) => p.key)
    .reverse()
    .slice(0, shown.length - want);
  return { add: 0, drop };
}

/** TERM-006: where a pane split from `key` lands in the shown order: right is the next cell,
 * down is the cell below in a grid `cols` wide. */
// ponytail: the grid is uniform cells, so "below" is an index jump, not a nested split tree.
export function splitIndex(shownKeys: number[], key: number, dir: "right" | "down", cols: number): number {
  const i = shownKeys.indexOf(key);
  if (i < 0) return shownKeys.length;
  return Math.min(shownKeys.length, dir === "right" ? i + 1 : i + cols);
}

/** Puts `pane` at position `at` among the panes shown for `dir`; panes of other workspaces keep
 * their places. */
export function insertShown<P extends PaneLike>(panes: P[], dir: string | null, at: number, pane: P): P[] {
  const next = panesIn(panes, dir)[at];
  if (!next) return [...panes, pane];
  const i = panes.indexOf(next);
  return [...panes.slice(0, i), pane, ...panes.slice(i)];
}
