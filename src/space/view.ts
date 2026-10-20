// VIEW-014 / PROJ-083: what the Space page decides without the window: a row's state word, the
// treemap's items, which selected rows go to the delete after their safety checks (never with force),
// the question's wording, and what the table shows once a batch came back.
import { blocker, type RemoveCheck } from "../projects/deleting";
import { folderName } from "../projects/model";
import { formatBytes, type SpaceRow } from "../projects/space";
import { sameDir } from "../workspaces";

export type Skipped = { path: string; why: string };
export type Pick = { path: string; stamp: string };
export type Done = { path: string; outcome: string; message: string | null; kept?: string | null };
export type Batch = { items: Done[]; summary: string };

/** The branch when it has one, else the folder's name. */
export const labelOf = (row: SpaceRow): string => row.branch ?? folderName(row.path);

/** The paths of the listed worktrees that a pane is open in (any pane: a browser, an agent or a shell). */
export const activeOf = (rows: SpaceRow[], openDirs: string[]): Set<string> => new Set(rows.filter((r) => openDirs.some((d) => sameDir(d, r.path))).map((r) => r.path));

/** The state column: the main checkout, in use, deletable, or kept (nothing Kolux may reclaim). */
export function stateOf(row: SpaceRow, active: ReadonlySet<string>): "Main" | "In use" | "Deletable" | "Kept" {
  if (row.isMain) return "Main";
  if (active.has(row.path)) return "In use";
  return row.reclaimable ? "Deletable" : "Kept";
}

export const treemapItems = (rows: SpaceRow[]) => rows.map((r) => ({ label: labelOf(r), bytes: r.size.bytes }));

/** After the safety checks: clean rows become picks carrying the check's stamp; a row with uncommitted
 * changes, a lock, a nested worktree or a failed check is skipped with the reason (PROJ-083: no force). */
export function plan(go: SpaceRow[], checks: Record<string, RemoveCheck | string>): { picks: Pick[]; skipped: Skipped[] } {
  const picks: Pick[] = [];
  const skipped: Skipped[] = [];
  for (const row of go) {
    const c = checks[row.path];
    if (c === undefined || typeof c === "string") skipped.push({ path: row.path, why: c ?? "The check did not run" });
    else if (blocker(c) !== null) skipped.push({ path: row.path, why: blocker(c) as string });
    else if (c.changes.length > 0) skipped.push({ path: row.path, why: `It has ${c.changes.length} uncommitted ${c.changes.length === 1 ? "change" : "changes"}` });
    else picks.push({ path: row.path, stamp: c.stamp });
  }
  return { picks, skipped };
}

/** The question before the batch; null when nothing can go (the skipped list is then shown as a note). */
export function question(go: SpaceRow[], picks: Pick[], skipped: Skipped[]): { title: string; lines: string[]; confirm: string } | null {
  if (picks.length === 0) return null;
  const rows = picks.map((p) => go.find((r) => r.path === p.path)).filter((r): r is SpaceRow => r !== undefined);
  const bytes = rows.reduce((a, r) => a + r.size.bytes, 0);
  const n = rows.length;
  return {
    title: n === 1 ? `Delete the worktree ${labelOf(rows[0])}?` : `Delete ${n} worktrees?`,
    lines: [`${formatBytes(bytes)} comes back. The folders are removed and Git forgets the worktrees; the branches stay.`, ...skipped.map((s) => `Skipped ${folderName(s.path)}: ${s.why}`)],
    confirm: n === 1 ? "Delete" : `Delete ${n}`,
  };
}

/** The rows that stay after a batch (removed ones go), and one line to show. */
export function afterBatch(rows: SpaceRow[], batch: Batch): { rows: SpaceRow[]; note: string } {
  const gone = new Set(batch.items.filter((i) => i.outcome === "removed").map((i) => i.path));
  const problems = batch.items.filter((i) => i.outcome !== "removed" && i.message).map((i) => `${folderName(i.path)}: ${i.message}`);
  return { rows: rows.filter((r) => !gone.has(r.path)), note: [batch.summary, ...problems].join(" · ") };
}
