// PROJ-080 / PROJ-073: the model behind the workspace cleanup dialog and the kept-branch notice.
// What the scan lists, what comes ticked, what survives a rescan, and the branches a removal left.

/** One Kolux-made workspace as `cleanup_scan` reports it. */
export type ScanRow = {
  path: string;
  branch: string | null;
  name: string | null;
  idleDays: number | null;
  changes: number;
  merged: boolean;
  /** Its branch holds commits that are in no other branch; removing the workspace keeps the branch. */
  unmerged: boolean;
  active: boolean;
  locked: boolean;
  missing: boolean;
  quiet: boolean;
  preselect: boolean;
  keepsBranch: boolean;
  note: string | null;
};

export type Scan = { projectId: string; rows: ScanRow[]; error: string | null; timedOut: boolean; atMs: number };

/** A branch a removed workspace left behind, with the commit it pointed at then (PROJ-073). */
export type KeptBranch = { branch: string; commit: string };
/** The same, with the project it belongs to, so a batch from several projects can share one list. */
export type KeptItem = KeptBranch & { projectId: string };

export type Cleaned = { removed: string[]; left: { path: string; why: string }[]; kept: KeptBranch[] };
export type BranchResult = { branch: string; deleted: boolean; why: string | null };

const lastSegment = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;

export const rowLabel = (r: ScanRow) => r.name ?? r.branch ?? lastSegment(r.path);

/** The rows the dialog shows: the ones gone quiet, or every workspace when "show all" is on. */
export const shownRows = (scan: Scan, showAll: boolean): ScanRow[] => (showAll ? scan.rows : scan.rows.filter((r) => r.quiet));

/** What the dialog ticks when it opens: clean, inactive, quiet workspaces whose commits are all in the base (or whose folder is gone). */
export const preselected = (scan: Scan): string[] => scan.rows.filter((r) => r.preselect).map((r) => r.path);

/** The facts that explain a row, in plain words. */
export function rowFacts(r: ScanRow): string {
  const out: string[] = [];
  if (r.missing) out.push("folder is gone");
  else if (r.idleDays !== null) out.push(r.idleDays === 0 ? "touched today" : `idle ${r.idleDays} day${r.idleDays === 1 ? "" : "s"}`);
  if (r.merged) out.push("merged");
  if (r.unmerged && !r.merged) out.push("unmerged commits");
  if (r.changes > 0) out.push(`${r.changes} uncommitted change${r.changes === 1 ? "" : "s"}`);
  else if (!r.missing && r.note === null) out.push("clean");
  if (r.active) out.push("a terminal is open");
  if (r.locked) out.push("locked");
  if (r.keepsBranch) out.push("its branch stays");
  if (r.note) out.push(r.note);
  return out.join(" · ");
}

/** Ticks after a scan: a workspace the user already ticked or unticked keeps that choice; a new one follows `preselect`; one that vanished is dropped. */
export function ticksAfterScan(before: Record<string, boolean> | null, scan: Scan): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const r of scan.rows) out[r.path] = before && r.path in before ? before[r.path] : r.preselect;
  return out;
}

export const tickedPaths = (ticks: Record<string, boolean>, scan: Scan, showAll: boolean): string[] => shownRows(scan, showAll).filter((r) => ticks[r.path]).map((r) => r.path);

// The previous result shows straight away while a new scan runs, and the filter stays as it was.
const lastScans = new Map<string, Scan>();
const showAllFor = new Map<string, boolean>();
const lastTicks = new Map<string, Record<string, boolean>>();

export const rememberScan = (scan: Scan) => {
  // A scan that failed or timed out never replaces a good result.
  if (scan.error === null) lastScans.set(scan.projectId, scan);
};
export const lastScan = (projectId: string): Scan | null => lastScans.get(projectId) ?? null;
export const rememberShowAll = (projectId: string, on: boolean) => void showAllFor.set(projectId, on);
export const rememberedShowAll = (projectId: string) => showAllFor.get(projectId) ?? false;
export const rememberTicks = (projectId: string, ticks: Record<string, boolean>) => void lastTicks.set(projectId, ticks);
export const rememberedTicks = (projectId: string) => lastTicks.get(projectId) ?? null;
export const forgetCleanupMemory = () => {
  lastScans.clear();
  showAllFor.clear();
  lastTicks.clear();
};

/** Adds branches to the pending list, once each (by project and branch); the newest commit wins. */
export function addKept(current: KeptItem[], more: KeptItem[]): KeptItem[] {
  const out = current.filter((c) => !more.some((m) => m.projectId === c.projectId && m.branch === c.branch));
  return [...out, ...more];
}

/** One branch is a toast with a Delete button; a batch opens a single review list. */
export const keptView = (items: KeptItem[]): "none" | "toast" | "review" => (items.length === 0 ? "none" : items.length === 1 ? "toast" : "review");

/** Only ticked branches are deleted, grouped per project so each repository gets one batch, in order. */
export function keptBatches(items: KeptItem[], ticked: Record<string, boolean>): { projectId: string; items: KeptBranch[] }[] {
  const out: { projectId: string; items: KeptBranch[] }[] = [];
  for (const k of items) {
    if (!ticked[`${k.projectId}\n${k.branch}`]) continue;
    const batch = out.find((b) => b.projectId === k.projectId);
    const one = { branch: k.branch, commit: k.commit };
    if (batch) batch.items.push(one);
    else out.push({ projectId: k.projectId, items: [one] });
  }
  return out;
}

/** What is left on the list after a delete: the refused ones stay, so the reason can be read. */
export const keptAfter = (items: KeptItem[], results: BranchResult[]): KeptItem[] => items.filter((k) => !results.some((r) => r.branch === k.branch && r.deleted));
