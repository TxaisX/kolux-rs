// GIT-037 (T-033-c): which split a diff opens in when a Source Control row or an All Changes row
// is clicked: the split the focus is in (the default), the one beside it, or a split of its own.
// Saved as a setting; App's openDiff asks `targetCell` for the cell.

export const DIFF_SPLIT_KEY = "scmDiffSplit";
export type DiffSplit = "here" | "beside" | "new";
export const DIFF_SPLITS: [DiffSplit, string][] = [
  ["here", "This split"],
  ["beside", "Next split"],
  ["new", "New split"],
];
export const diffSplitOf = (v: unknown): DiffSplit => (v === "beside" || v === "new" ? v : "here");

/** The cell a diff opens in: `cells` are the workspace's cells in screen order, `here` the focused
 * pane's cell (undefined when nothing in the workspace has the focus). Undefined means a cell of
 * its own. "Next split" wraps around, and with one cell it opens a new one. */
export const targetCell = (cells: number[], here: number | undefined, choice: DiffSplit): number | undefined => {
  if (choice === "new" || here === undefined) return undefined;
  if (choice === "here" || cells.length < 2) return choice === "here" ? here : undefined;
  const i = cells.indexOf(here);
  return cells[(i + 1) % cells.length];
};
