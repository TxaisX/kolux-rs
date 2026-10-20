// EDIT-035 (T-236-b): what the explorer shows after the name filter and the dotfiles switch. Pure
// row work, so the tree's own loading stays in Explorer.tsx.
import type { Node, Row } from "./Explorer";

/** A name matches when it holds the typed text, in any letter case; an empty filter matches all. */
export const matchesName = (name: string, query: string): boolean => {
  const q = query.trim().toLowerCase();
  return q === "" || name.toLowerCase().includes(q);
};

/** The rows that match the filter, each with the folders above it so the match stays reachable. The
 * rows come in tree order (every loaded folder open), and so do the rows returned. */
export function filterRows(rows: Row[], query: string): Row[] {
  if (query.trim() === "") return rows;
  const byPath = new Map(rows.map((r) => [r.node.path, r]));
  const keep = new Set<string>();
  for (const r of rows) {
    if (!matchesName(r.node.name, query)) continue;
    for (let at: Row | undefined = r; at && !keep.has(at.node.path); at = at.parent === null ? undefined : byPath.get(at.parent)) keep.add(at.node.path);
  }
  return rows.filter((r) => keep.has(r.node.path));
}

/** Dotfiles and dot-folders left out of every loaded folder when the switch hides them. */
export function withoutDotfiles(kids: Record<string, Node[] | undefined>): Record<string, Node[] | undefined> {
  const out: Record<string, Node[] | undefined> = {};
  for (const [dir, list] of Object.entries(kids)) out[dir] = list?.filter((n) => !n.name.startsWith("."));
  return out;
}

/** The settings-free memory of the dotfiles switch, kept per worktree in the browser (a per-viewer
 * convenience): shown unless this worktree was set to hide them. */
export const DOTFILES_KEY = "kolux.explorer.hideDotfiles";
export const hidesDotfiles = (raw: string | null, root: string): boolean => {
  try {
    const list = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(list) && list.includes(root.toLowerCase());
  } catch {
    return false;
  }
};
export function withDotfiles(raw: string | null, root: string, hide: boolean): string {
  let list: string[] = [];
  try {
    const got = raw === null ? [] : JSON.parse(raw);
    if (Array.isArray(got)) list = got.filter((x): x is string => typeof x === "string");
  } catch {
    list = [];
  }
  const key = root.toLowerCase();
  list = list.filter((x) => x !== key);
  if (hide) list.push(key);
  return JSON.stringify(list.slice(-200));
}

/** EDIT-035: the memory of the "hide git-ignored files" switch, kept per worktree like the dotfiles one. Git-ignored files are shown unless a worktree was set to hide them. */
export const IGNORED_KEY = "kolux.explorer.hideIgnored";

/** True when two reads of a folder list the same entries in the same order. */
export function sameNodes(a: Node[] | undefined, b: Node[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((n, i) => n.path === b[i].path && n.kind === b[i].kind);
}

/** Names git ignores, left out of every loaded folder (`ignored` maps a folder to its ignored names). */
export function withoutIgnored(kids: Record<string, Node[] | undefined>, ignored: Record<string, string[] | undefined>): Record<string, Node[] | undefined> {
  const out: Record<string, Node[] | undefined> = {};
  for (const [dir, list] of Object.entries(kids)) {
    const skip = new Set(ignored[dir] ?? []);
    const kept = skip.size ? list?.filter((n) => !skip.has(n.name)) : list;
    out[dir] = kept && list && kept.length === list.length ? list : kept;
  }
  return out;
}

export type MenuId = "view" | "newFile" | "newFolder" | "rename" | "delete" | "copyPath" | "copyRelative" | "findInFolder" | "openTerminal" | "addProject";
export const MENU_LABEL: Record<MenuId, string> = {
  view: "View file",
  newFile: "New file here",
  newFolder: "New folder here",
  rename: "Rename",
  delete: "Delete",
  copyPath: "Copy path",
  copyRelative: "Copy relative path",
  findInFolder: "Find in folder",
  openTerminal: "Open in terminal",
  addProject: "Add as project",
};

/** The entries of a row's context menu (EDIT-035). A folder can be searched and made into a project (only where the sidebar can add one); the terminal item needs a host that opens terminals. */
export function rowMenu(o: { isDir: boolean; hasTerminal: boolean; canProject: boolean }): MenuId[] {
  const out: MenuId[] = o.isDir ? ["newFile", "newFolder", "findInFolder"] : ["view"];
  if (o.hasTerminal) out.push("openTerminal");
  if (o.isDir && o.canProject) out.push("addProject");
  out.push("rename", "delete", "copyPath", "copyRelative");
  return out;
}

/** The include pattern that limits a content search to one folder of the worktree ("" for the worktree itself). */
export function folderGlob(root: string, dir: string): string {
  const fwd = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const r = fwd(root);
  const d = fwd(dir);
  if (d.toLowerCase() === r.toLowerCase()) return "";
  if (!d.toLowerCase().startsWith(r.toLowerCase() + "/")) return "";
  return d.slice(r.length + 1) + "/**";
}
