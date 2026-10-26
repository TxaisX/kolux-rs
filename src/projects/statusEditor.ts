// PROJ-084: the editor for the workspace statuses. Rows keep the id a status already has, so
// reordering or renaming never moves a workspace; a new row has none until Rust makes one.
export type StatusRow = { id: string | null; label: string };

export const editorRows = (list: { id: string; label: string }[]): StatusRow[] => list.map((s) => ({ id: s.id, label: s.label }));
export const addRow = (rows: StatusRow[], label = ""): StatusRow[] => [...rows, { id: null, label }];
export const renameRow = (rows: StatusRow[], at: number, label: string): StatusRow[] => rows.map((r, i) => (i === at ? { ...r, label } : r));
export const removeRow = (rows: StatusRow[], at: number): StatusRow[] => rows.filter((_, i) => i !== at);
/** Moves a row one place up (-1) or down (1); at an end the same array comes back. */
export function moveRow(rows: StatusRow[], at: number, by: -1 | 1): StatusRow[] {
  const to = at + by;
  if (at < 0 || at >= rows.length || to < 0 || to >= rows.length) return rows;
  const next = [...rows];
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}
/** At least one status needs a label: an empty list would fall back to the default set. */
export const canSave = (rows: StatusRow[]): boolean => rows.some((r) => r.label.trim() !== "");
/** What workspace_statuses_set takes: (id or none, label) in order; blank labels are left out. */
export const savePayload = (rows: StatusRow[]): [string | null, string][] => rows.filter((r) => r.label.trim() !== "").map((r) => [r.id, r.label.trim()]);
