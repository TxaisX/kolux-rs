// VIEW-059 / VIEW-060 (T-224-b): the pieces of the Explorer toolbar and row menu that were still open
// after T-236-b: expand all, a refresh that shows it is running, paths that compare the way Windows
// does, and the two row-menu entries the card names (collapse an open folder, copy a file to the
// system clipboard). Pure, so Explorer.tsx only wires them in.
import type { Node } from "./Explorer";
import { MENU_LABEL, type MenuId } from "./explorerView";

/** Expand all opens at most this many folders in one go, so a huge tree is not read whole. */
export const EXPAND_CAP = 300;
/** Folders expand-all never opens: dot folders and the two build-output folders that hold thousands of files. */
const SKIPPED = new Set(["node_modules", "target"]);

/** The folders to open next: the folders listed in `lists` that are not `seen` yet, at most `room` of them. */
export function nextWave(lists: Record<string, Node[] | undefined>, seen: ReadonlySet<string>, room: number): string[] {
  const out: string[] = [];
  for (const kids of Object.values(lists)) {
    for (const n of kids ?? []) {
      if (out.length >= room) return out;
      if (n.kind === "dir" && !seen.has(n.path) && !n.name.startsWith(".") && !SKIPPED.has(n.name)) out.push(n.path);
    }
  }
  return out;
}

const isWindowsPath = (p: string) => /^[a-z]:[\\/]/i.test(p) || p.startsWith("\\\\") || p.startsWith("//");
const norm = (p: string) => (isWindowsPath(p) ? p.replace(/\//g, "\\").toLowerCase() : p);

/**
 * Whether `p` lies inside folder `dir`. On Windows (drive and network-share paths) letter case and the
 * slash direction do not matter; on every system only whole folder names count, so a neighbouring
 * share with a similar name is not inside the tree.
 */
export function insideDir(p: string, dir: string): boolean {
  const base = norm(dir).replace(/[\\/]+$/, "");
  const at = norm(p);
  return at.startsWith(base + "\\") || at.startsWith(base + "/");
}

export type ExtraId = "collapse" | "copyFile" | "follow";
export type AnyMenuId = MenuId | ExtraId;
export const menuLabel = (id: AnyMenuId): string => (id === "collapse" ? "Collapse" : id === "copyFile" ? "Copy as file" : id === "follow" ? "Follow log" : MENU_LABEL[id]);

/** Row-menu entries added to rowMenu's own list: Collapse leads an open folder's menu, Follow log comes after a log file's
 * View file (EDIT-026, T-317), Copy as file ends a single file's copy items. */
export function withExtraMenu(base: MenuId[], o: { isDir: boolean; isOpen: boolean; single: boolean; log?: boolean }): AnyMenuId[] {
  const out: AnyMenuId[] = [...base];
  if (o.isDir && o.isOpen) out.unshift("collapse");
  if (!o.isDir && o.log) out.splice(out.indexOf("view") + 1, 0, "follow");
  if (!o.isDir && o.single) out.push("copyFile");
  return out;
}

/** The host's file open (App's openFile): the path, the line and column to show, and whether the tab follows a growing log. */
export type OpenFile = (path: string, line?: number, column?: number, follow?: boolean) => void;
/** EDIT-026 (T-317): View file opens a plain tab; Follow log opens a read-only tab that keeps adding lines as the log grows. */
export const openRow = (id: "view" | "follow", path: string, onOpen: OpenFile) => onOpen(path, undefined, undefined, id === "follow");
