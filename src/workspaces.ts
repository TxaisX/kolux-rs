// Which panes belong to which workspace (PROJ-066). A workspace is a folder: a project's main
// checkout or one of its worktrees. The window shows one workspace at a time; the others keep
// their panes mounted but hidden, so switching back finds every terminal exactly as it was.
// `null` is the home group: panes that were opened in no workspace (the first PowerShell pane).

export type PaneLike = { key: number; cwd: string | null };

const trim = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();

/** Same folder, whichever slash style or trailing slash either side uses. */
/** PROJ-021: the name typed for the workspace a pane runs in, exactly as typed; nothing for a folder with no typed name. */
export function nameOf(names: Record<string, string>, cwd: string | null): string | undefined {
  if (!cwd) return undefined;
  return Object.entries(names).find(([dir]) => sameDir(dir, cwd))?.[1];
}

export function sameDir(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return trim(a) === trim(b);
}

/** Is `path` the folder `root` or inside it? */
export function underDir(path: string | null, root: string): boolean {
  if (path === null) return false;
  const p = trim(path);
  const r = trim(root);
  return p === r || p.startsWith(r + "\\");
}

/** The panes shown for a workspace. */
export function panesIn<P extends PaneLike>(panes: P[], dir: string | null): P[] {
  return panes.filter((p) => sameDir(p.cwd, dir));
}

/** Keeps the focus where it is when that pane is shown, else moves it to the first shown pane. */
export function focusIn(panes: PaneLike[], dir: string | null, focused: number): number {
  const shown = panesIn(panes, dir);
  if (shown.some((p) => p.key === focused)) return focused;
  return shown[0]?.key ?? focused;
}

/** Removing a workspace closes every pane in it (PROJ-066: none of its tabs remain anywhere). */
export function withoutDir<P extends PaneLike>(panes: P[], root: string): P[] {
  return panes.filter((p) => !underDir(p.cwd, root));
}

/** Where to go when the shown workspace is removed: stay unless it was the one removed, then the home group. */
export function activeAfterRemove(active: string | null, removed: string): string | null {
  return active !== null && underDir(active, removed) ? null : active;
}
