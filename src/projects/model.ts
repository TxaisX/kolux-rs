// The shapes the Rust side hands over for projects and workspaces, plus the pure helpers the
// sidebar draws from. No Tauri calls here, so it can be tested on its own.

export type Project = { id: string; name: string; path: string; workspacesDir?: string | null; base?: string | null };
/** What a typed name becomes in a project: its branch and the folder it would get (PROJ-021, PROJ-025). */
export type Preview = { branch: string; folder: string };
/** A workspace just made: the worktree, the ref it started from, a note when the saved base was gone (PROJ-028), and what could not be brought along (GIT-067). */
export type Created = Worktree & { base: string; note: string | null; warnings: string[] };
/** The global workspaces settings (PROJ-025): folder in use, layout, folders used before, and whether KOLUX_WORKSPACES_DIR supplies the folder (SET-032). */
export type PlaceInfo = { dir: string; flat: boolean; used: string[]; fromEnv: boolean };

/** What a key does in the workspaces-folder field (SET-032): Enter saves, Escape puts the saved folder back, and nothing happens while an input method is still composing. */
export function placeFieldAction(key: string, composing: boolean): "save" | "revert" | null {
  if (composing) return null;
  return key === "Enter" ? "save" : key === "Escape" ? "revert" : null;
}
/** `parent` is the workspace it was made from (PROJ-047); gone or main means it sits at the top level. */
export type Worktree = { path: string; branch: string | null; head: string; isMain: boolean; name?: string | null; parent?: string | null };

/** The last folder name of a path, whichever slash style it uses. */
export function folderName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** What a workspace row says (PROJ-021): the name as typed, else the branch, else the short commit of a detached head. */
export function worktreeLabel(w: Worktree): string {
  if (w.name) return w.name;
  if (w.branch) return w.branch;
  return `detached at ${w.head.slice(0, 7)}`;
}

/** Rows in display order: the main checkout first, then the others by branch name. */
export function orderWorktrees(list: Worktree[]): Worktree[] {
  return [...list].sort((a, b) => {
    if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
    return worktreeLabel(a).localeCompare(worktreeLabel(b));
  });
}

/** A sidebar row: the workspace, how deep it is indented and whether it has children to fold. */
export type Row = { w: Worktree; depth: number; kids: boolean };

/** The settings key that turns nesting off (PROJ-047); on unless set to false. */
export const NESTING_KEY = "workspaceNesting";

/**
 * PROJ-047: the non-main workspaces as rows, each child under its parent to any depth, siblings
 * in `sort` order (`orderWorktrees` unless the caller sorted already). A child whose parent is not listed (removed, or the main checkout)
 * sits at the top level; a folded row hides everything under it; nesting off is one flat level.
 */
export function nestRows(others: Worktree[], nest: boolean, folded: ReadonlySet<string>, sort: (ws: Worktree[]) => Worktree[] = orderWorktrees): Row[] {
  const sorted = sort(others);
  if (!nest) return sorted.map((w) => ({ w, depth: 0, kids: false }));
  const listed = new Set(sorted.map((w) => w.path));
  const under = new Map<string, Worktree[]>();
  for (const w of sorted) {
    const p = w.parent && w.parent !== w.path && listed.has(w.parent) ? w.parent : "";
    under.set(p, [...(under.get(p) ?? []), w]);
  }
  const rows: Row[] = [];
  const seen = new Set<string>();
  const walk = (parent: string, depth: number, hidden: boolean) => {
    for (const w of under.get(parent) ?? []) {
      if (seen.has(w.path)) continue;
      seen.add(w.path);
      const kids = (under.get(w.path) ?? []).length > 0;
      if (!hidden) rows.push({ w, depth, kids });
      walk(w.path, depth + 1, hidden || folded.has(w.path));
    }
  };
  walk("", 0, false);
  // A loop of parents (a is b's, b is a's) never reaches the top; list those flat rather than lose them.
  for (const w of sorted) if (!seen.has(w.path)) rows.push({ w, depth: 0, kids: false });
  return rows;
}

/** The sentence under the name field: where the branch and folder will go, or why it is refused. */
export function previewSentence(typed: string, preview: Preview | null, project: Project | null): string {
  if (!project) return "Add a project first.";
  if (typed.trim() === "") return "Type a name; its branch and folder are shown here.";
  if (preview === null) return "That name leaves nothing usable for a branch; use some letters or digits.";
  return `branch ${preview.branch} · folder ${preview.folder}`;
}

/** What the command line tells the window after `worktree create` or `worktree rm` (PROJ-077). */
export type CliWorkspace =
  | { kind: "created"; projectId: string; worktree: Created; agent: string | null; prompt: string; activate: boolean }
  | { kind: "start"; path: string; branch: string | null; agent: string; prompt: string; extra: string[]; title: string | null }
  | { kind: "removed"; path: string };
