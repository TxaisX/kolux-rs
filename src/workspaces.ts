// Which panes belong to which workspace (PROJ-066). A workspace is a folder: a project's main
// checkout or one of its worktrees. The window shows one workspace at a time; the others keep
// their panes mounted but hidden, so switching back finds every terminal exactly as it was.
// `null` is the home group: panes that were opened in no workspace (the first PowerShell pane).

export type PaneLike = { key: number; cwd: string | null };

// One spelling per folder: backslashes, no trailing slash, any case, "." and ".." worked out
// (USAGE-017: a path that climbs out of a folder is not inside it).
const trim = (p: string) => {
  const out: string[] = [];
  for (const part of p.replace(/\//g, "\\").toLowerCase().split("\\")) {
    if (part === "..") {
      if (out.length > 1) out.pop();
    } else if (part !== ".") out.push(part);
  }
  return out.join("\\").replace(/\\+$/, "");
};

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

/** Where to go when the shown workspace is removed: stay unless it was the one removed, then the
 * most recently used sibling in the same project (PROJ-070), else the home group. */
export function activeAfterRemove(active: string | null, removed: string, recent: string[] = [], siblings: string[] = []): string | null {
  if (active === null || !underDir(active, removed)) return active;
  return recent.find((d) => !underDir(d, removed) && siblings.some((s) => sameDir(s, d))) ?? null;
}
