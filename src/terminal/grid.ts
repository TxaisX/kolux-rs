// The pane grid's arithmetic (TERM-001, TERM-004, TERM-006, TERM-040): how many cells a workspace
// may hold, how they tile, what a resize adds or drops, where a split lands, and which panes share
// a cell as tabs. Pure, so it is tested without a browser; the window applies the plan.
import type { PaneLike } from "../workspaces";

/** TERM-040: panes with the same group share one grid cell as tabs; a pane without one is its own cell. */
export type Tabbed = PaneLike & { group?: number };

export const groupOf = (p: { key: number; group?: number }): number => p.group ?? p.key;

/** The grid cells, in the order their first pane appears. */
export function cellsOf<P extends Tabbed>(panes: P[]): { group: number; panes: P[] }[] {
  const cells: { group: number; panes: P[] }[] = [];
  for (const p of panes) {
    const g = groupOf(p);
    const cell = cells.find((c) => c.group === g);
    if (cell) cell.panes.push(p);
    else cells.push({ group: g, panes: [p] });
  }
  return cells;
}

/** The tab that takes over when `key` closes: the one after it, else the one before, else none. */
export function neighbourTab(keys: number[], key: number): number | null {
  const i = keys.indexOf(key);
  const rest = keys.filter((k) => k !== key);
  return i < 0 ? null : (rest[Math.min(i, rest.length - 1)] ?? null);
}

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

/** Puts `pane` just before `next` (at the end when there is none); every other pane keeps its place. */
export function insertBefore<P>(panes: P[], next: P | undefined, pane: P): P[] {
  const i = next ? panes.indexOf(next) : -1;
  return i < 0 ? [...panes, pane] : [...panes.slice(0, i), pane, ...panes.slice(i)];
}
