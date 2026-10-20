// VIEW-078: what the ports popover shows, worked out from the scan: the active workspace's ports first,
// every other program's port after them as external, and how a click on Open or Stop is routed.

export type PortRow = {
  port: number;
  address: string;
  pid: number;
  name: string;
  worktree: string | null;
  external: boolean;
  /** The program's start time as the system counts it, as text (too large for a JS number); Stop sends it back. */
  started: string | null;
  /** The terminal whose pane started the program, or null when none did. */
  terminal: number | null;
};
export type Scan = { rows: PortRow[]; problem: string | null };

/** A scan that failed names the problem and keeps the last good list; a good one clears the problem. */
export function applyScan(prev: Scan, result: { rows: PortRow[] } | { error: string }): Scan {
  return "error" in result ? { rows: prev.rows, problem: result.error } : { rows: result.rows, problem: null };
}

const key = (p: string) => p.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();

/**
 * The workspace's own ports and the external ones. With `active` named, only its ports are the
 * workspace's own; another workspace's ports are still listed, as external, so nothing vanishes and
 * nothing outside the active workspace gets a Stop button.
 */
export function sections(rows: PortRow[], active?: string): { mine: PortRow[]; external: PortRow[] } {
  const own = (r: PortRow) => !r.external && r.worktree !== null && (active === undefined || key(r.worktree) === key(active));
  return { mine: rows.filter(own), external: rows.filter((r) => !own(r)) };
}

/**
 * What Stop sends: the port, the program the row showed on it and that program's start time as the
 * scan gave it (the Rust side refuses when a different program holds the port by then, or the same
 * process number with another start time), licensed by the active workspace alone, or by the row's
 * own folder when no workspace is active. An external row licenses nothing.
 */
export function stopRequest(row: PortRow, active?: string): { worktrees: string[]; port: number; pid: number; started: string | null } {
  const tree = active ?? row.worktree;
  return { worktrees: tree === null ? [] : [tree], port: row.port, pid: row.pid, started: row.started };
}

/** Open goes to the Kolux browser; Shift with the link modifier (Ctrl, or Cmd on a Mac) goes to the system browser. */
export function openTarget(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, mac: boolean): "kolux" | "system" {
  return e.shiftKey && (mac ? e.metaKey : e.ctrlKey) ? "system" : "kolux";
}

/** The folder's own name, for the line under a port. */
export const folderName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

/** The ports in the status bar item: only the workspace's own. */
export const countOf = (rows: PortRow[], active?: string) => sections(rows, active).mine.length;
