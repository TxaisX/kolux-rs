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
