// EDIT-011 (T-234-b): the hover controls of a table in the rich view. Pointing at a table shows a plus
// between two rows or two columns and a cross on the row or column under the pointer. They sit in the
// strip just outside the table (left of the rows, above the columns), never over a cell, so they can
// never block a click into one. This file is the geometry: where the pointer is against the rows
// and columns, and which edit each control stands for. The overlay (TableHover.tsx) only draws it.
import type { TableEdit } from "./richTable";

/** A table's box and the lines between its rows and columns, all in the same pixels (the screen's).
 *  `rows` and `cols` hold the edges: n rows have n + 1 numbers, from the top edge to the bottom edge. */
export type Geo = { left: number; top: number; right: number; bottom: number; rows: number[]; cols: number[] };

/** How far outside the table the controls still show, and how close to a line a plus appears. */
export const GUTTER = 24;
export const SNAP = 12;

export type Control = { edit: TableEdit; /** where its middle is: x for a column control, y for a row control */ at: number; kind: "add" | "del" };
export type Controls = { rows: Control[]; cols: Control[] };

const NONE: Controls = { rows: [], cols: [] };

/** The index of the band `v` falls in (edges ascending), or -1. */
function band(edges: number[], v: number): number {
  for (let i = 0; i + 1 < edges.length; i++) if (v >= edges[i] && v < edges[i + 1]) return i;
  return -1;
}

/** The line closest to `v` within SNAP, as its number (0 is the first edge), or -1. */
function nearest(edges: number[], v: number): number {
  let best = -1;
  let dist = SNAP + 1;
  edges.forEach((e, i) => {
    const d = Math.abs(e - v);
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return best;
}

/** The controls to show for the pointer at (x, y) over the table named `table`, or none when the pointer is
 *  neither over the table nor in the strip around it. A row control shows when the pointer is at the
 *  table's left strip or over its rows; a column control when it is in the top strip or over its columns.
 *  There is never a plus above the header row and the header row has no cross. */
export function hoverControls(table: string, g: Geo, x: number, y: number): Controls {
  const inX = x >= g.left - GUTTER && x <= g.right + GUTTER;
  const inY = y >= g.top - GUTTER && y <= g.bottom + GUTTER;
  if (!inX || !inY || g.rows.length < 2 || g.cols.length < 2) return NONE;
  const rows: Control[] = [];
  const cols: Control[] = [];
  const leftStrip = x < g.left + SNAP; // at or beside the left edge, where the row controls are drawn
  const topStrip = y < g.top + SNAP;
  if (leftStrip && y >= g.top && y <= g.bottom) {
    const r = band(g.rows, y);
    const line = nearest(g.rows, y);
    if (line >= 1) rows.push({ edit: { kind: "row-add", table, at: line }, at: g.rows[line], kind: "add" });
    if (r >= 1) rows.push({ edit: { kind: "row-del", table, at: r }, at: (g.rows[r] + g.rows[r + 1]) / 2, kind: "del" });
  }
  if (topStrip && x >= g.left && x <= g.right) {
    const c = band(g.cols, x);
    const line = nearest(g.cols, x);
    if (line >= 0) cols.push({ edit: { kind: "col-add", table, at: line }, at: g.cols[line], kind: "add" });
    if (c >= 0) cols.push({ edit: { kind: "col-del", table, at: c }, at: (g.cols[c] + g.cols[c + 1]) / 2, kind: "del" });
  }
  return { rows, cols };
}

/** True when a click at (x, y) lands on a control's own spot rather than a cell: controls are drawn only in the
 *  strips outside the table box, so any point inside it belongs to the cell underneath. */
export function overCell(g: Geo, x: number, y: number): boolean {
  return x >= g.left && x <= g.right && y >= g.top && y <= g.bottom;
}

/** The right-click menu: what each row and column entry does for the cell at row `r`, column `c` of the table
 *  (the header row, number 0, cannot be removed). */
export function menuEdits(table: string, r: number, c: number, cols: number): { label: string; edit: TableEdit; disabled: boolean }[] {
  return [
    { label: "Row above", edit: { kind: "row-add", table, at: Math.max(1, r) }, disabled: false },
    { label: "Row below", edit: { kind: "row-add", table, at: r + 1 }, disabled: false },
    { label: "Delete row", edit: { kind: "row-del", table, at: r }, disabled: r < 1 },
    { label: "Column left", edit: { kind: "col-add", table, at: c }, disabled: false },
    { label: "Column right", edit: { kind: "col-add", table, at: c + 1 }, disabled: false },
    { label: cols <= 1 ? "Delete table" : "Delete column", edit: { kind: "col-del", table, at: c }, disabled: false },
  ];
}
