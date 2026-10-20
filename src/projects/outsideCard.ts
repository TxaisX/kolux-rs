// PROJ-043: a compact card heads a project that holds worktrees brought in from outside Kolux. It
// expands to list them, or is dismissed for good. It is hidden while the project group is
// collapsed, and when the project has no other rows it still shows, directly under the header.

import type { Worktree } from "./model";

export type OutsideState = { outside: Worktree[]; dismissed: boolean; collapsed: boolean; otherRows: number };
export type OutsideCard = { show: boolean; count: number; placement: "above-rows" | "under-header" | null };

export function outsideCard(s: OutsideState): OutsideCard {
  const count = s.outside.length;
  if (count === 0 || s.dismissed || s.collapsed) return { show: false, count, placement: null };
  return { show: true, count, placement: s.otherRows === 0 ? "under-header" : "above-rows" };
}

export const outsideTitle = (count: number): string => (count === 1 ? "1 workspace from outside Kolux" : `${count} workspaces from outside Kolux`);

/** What the card lists when expanded: the outside worktrees by name, branch or folder. */
export function outsideLines(outside: Worktree[], max = 8): { lines: { path: string; label: string }[]; more: number } {
  const folder = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p;
  return {
    lines: outside.slice(0, max).map((w) => ({ path: w.path, label: w.name || w.branch || folder(w.path) })),
    more: Math.max(0, outside.length - max),
  };
}
