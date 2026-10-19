// VIEW-078: what the ports popover shows, worked out from the scan: the workspace's ports first, other
// programs' ports after them as external, and how a click on Open is routed.

export type PortRow = { port: number; address: string; pid: number; name: string; worktree: string | null; external: boolean };
export type Scan = { rows: PortRow[]; problem: string | null };

/** A scan that failed names the problem and keeps the last good list; a good one clears the problem. */
export function applyScan(prev: Scan, result: { rows: PortRow[] } | { error: string }): Scan {
  return "error" in result ? { rows: prev.rows, problem: result.error } : { rows: result.rows, problem: null };
}

const key = (p: string) => p.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();

/** The workspace ports (only `active`'s when one is named) and the external ones. */
export function sections(rows: PortRow[], active?: string): { mine: PortRow[]; external: PortRow[] } {
  return {
    mine: rows.filter((r) => !r.external && (active === undefined || (r.worktree !== null && key(r.worktree) === key(active)))),
    external: rows.filter((r) => r.external),
  };
}

/** Open goes to the Kolux browser; Shift with the link modifier (Ctrl, or Cmd on a Mac) goes to the system browser. */
export function openTarget(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, mac: boolean): "kolux" | "system" {
  return e.shiftKey && (mac ? e.metaKey : e.ctrlKey) ? "system" : "kolux";
}

/** The folder's own name, for the line under a port. */
export const folderName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

/** The ports in the status bar item: only the workspace's own. */
export const countOf = (rows: PortRow[], active?: string) => sections(rows, active).mine.length;
