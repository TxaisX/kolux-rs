// The shapes the Rust side hands over for projects and workspaces, plus the pure helpers the
// sidebar draws from. No Tauri calls here, so it can be tested on its own.

export type Project = { id: string; name: string; path: string };
export type Worktree = { path: string; branch: string | null; head: string; isMain: boolean };

/** The last folder name of a path, whichever slash style it uses. */
export function folderName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** What a workspace row says: the branch, or the short commit when the head is detached. */
export function worktreeLabel(w: Worktree): string {
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

/** The sentence under the name field: where the branch and folder will go, or why it is refused. */
export function previewSentence(typed: string, safe: string | null, root: string, project: Project | null): string {
  if (!project) return "Add a project first.";
  if (typed.trim() === "") return "Type a name; its branch and folder are shown here.";
  if (safe === null) return "That name leaves nothing usable for a branch; use some letters or digits.";
  return `branch ${safe} · folder ${root}\\${project.name}\\${safe}`;
}
