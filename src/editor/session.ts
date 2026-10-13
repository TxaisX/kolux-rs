// EDIT-004: each workspace's editor session (its open editor and preview tabs, the tab in front,
// each tab's caret and view mode, and unsaved text as a draft) is kept in the app's own store, so
// a quit or a crash brings the tabs back with their edits still unsaved. A draft is never written
// into the real file. The store keeps only workspaces whose folder still exists, and removing a
// workspace drops its session. The language is not stored: a restored tab finds it from the name.
import { keyOf } from "./buffers";
import { sameDir, underDir } from "../workspaces";

export type Mode = "rich" | "source";
export type SavedTab = { path: string; kind: "editor" | "preview"; caret?: number; mode?: Mode; draft?: string; base?: string };
export type Session = { dir: string; tabs: SavedTab[]; front: string | null };
/** What a restored tab starts with: its draft (and the stamp of the disk copy it was made from), caret and view mode. */
export type Start = { draft?: string; base?: string; caret?: number; mode?: Mode };

type OpenTab = { key: number; cwd: string | null; group?: number; kind?: string; path?: string };
const groupOf = (p: { key: number; group?: number }) => p.group ?? p.key;
const kept = (kind: unknown): kind is SavedTab["kind"] => kind === "editor" || kind === "preview";

/** A short stamp of a text (FNV-1a), to tell whether the disk copy moved on since a draft was kept. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16) + ":" + s.length.toString(16);
}

/** The sessions to keep for the panes open now. `frontOf` is the tab in front of a cell, `look`
 *  a tab's caret and mode, `draftOf` a file's unsaved text and the stamp (hashText) of the disk copy it differs from. */
export function collect(panes: OpenTab[], frontOf: (group: number) => number, look: (key: number) => { caret?: number; mode?: Mode } | undefined, draftOf: (path: string, key: number) => { text: string; base?: string } | null): Session[] {
  const out: Session[] = [];
  for (const p of panes) {
    if (p.cwd === null || !kept(p.kind) || !p.path) continue;
    let s = out.find((x) => sameDir(x.dir, p.cwd));
    if (!s) out.push((s = { dir: p.cwd, tabs: [], front: null }));
    const tab: SavedTab = { path: p.path, kind: p.kind, ...look(p.key) };
    const d = p.kind === "editor" ? draftOf(p.path, p.key) : null;
    if (d) Object.assign(tab, d.base === undefined ? { draft: d.text } : { draft: d.text, base: d.base });
    s.tabs.push(tab);
    if (s.front === null && frontOf(groupOf(p)) === p.key) s.front = p.path;
  }
  return out;
}

function cleanTab(t: unknown): SavedTab | null {
  if (!t || typeof t !== "object") return null;
  const r = t as Record<string, unknown>;
  if (typeof r.path !== "string" || !r.path) return null;
  const tab: SavedTab = { path: r.path, kind: r.kind === "preview" ? "preview" : "editor" };
  if (typeof r.caret === "number" && Number.isInteger(r.caret) && r.caret >= 0) tab.caret = r.caret;
  if (r.mode === "rich" || r.mode === "source") tab.mode = r.mode;
  // A read-only tab never carries a draft.
  if (tab.kind === "editor" && typeof r.draft === "string") {
    tab.draft = r.draft;
    if (typeof r.base === "string") tab.base = r.base;
  }
  return tab;
}

/** The saved sessions made safe to open: broken entries dropped, a file opened twice kept once,
 *  and a tab whose file lies in another known workspace (the closest one) moved under it. */
export function tidy(raw: unknown, known: string[]): Session[] {
  if (!Array.isArray(raw)) return [];
  const out: Session[] = [];
  const seen = new Set<string>();
  const into = (dir: string) => {
    let s = out.find((x) => sameDir(x.dir, dir));
    if (!s) out.push((s = { dir: dir.replace(/[\\/]+$/, ""), tabs: [], front: null }));
    return s;
  };
  for (const e of raw) {
    if (!e || typeof e !== "object" || typeof (e as Session).dir !== "string" || !Array.isArray((e as Session).tabs)) continue;
    const { dir, tabs, front } = e as Session;
    for (const t of tabs.map(cleanTab)) {
      if (!t || seen.has(t.kind + keyOf(t.path))) continue;
      seen.add(t.kind + keyOf(t.path));
      const owner = known.filter((k) => underDir(t.path, k)).sort((a, b) => b.length - a.length)[0];
      const s = into(owner ?? dir);
      s.tabs.push(t);
      if (s.front === null && typeof front === "string" && keyOf(front) === keyOf(t.path)) s.front = t.path;
    }
  }
  return out.filter((s) => s.tabs.length > 0);
}

/** Each session as one cell of tabs, keys from `first` on; `front` is each cell's tab in front. */
export function restore(sessions: Session[], first: number) {
  let key = first;
  const panes: { key: number; cwd: string; group: number; kind: SavedTab["kind"]; path: string; start: Start }[] = [];
  const front: Record<number, number> = {};
  for (const s of sessions) {
    const group = key;
    for (const { path, kind, ...start } of s.tabs) {
      if (s.front !== null && front[group] === undefined && keyOf(s.front) === keyOf(path)) front[group] = key;
      panes.push({ key, cwd: s.dir, group, kind, path, start });
      key++;
    }
  }
  return { panes, front, next: key };
}
