// PROJ-057 / VIEW-037: the worktree palette. One list with sections for open tabs, worktrees,
// projects, settings pages, quick actions and pull requests; every typed word has to match
// somewhere in a row, matches are highlighted, and Enter goes there or makes a workspace from the
// typed name.
import { Fragment, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { worktreeLabel, type Project, type Worktree } from "./model";
import { MAX_QUERY, matchWords, wordsOf } from "./nav";

/** A row the window supplies: its section, what it shows, and what Enter does. */
export type PaletteItem = { section: string; label: string; hint?: string; run: () => void };

export const SECTIONS = ["Open tabs", "Worktrees", "Projects", "Settings", "Quick actions", "Pull requests", "Help"] as const;

type Props = {
  projects: Project[];
  /** Rows other than worktrees and projects. */
  items: PaletteItem[];
  /** Each workspace folder's pull request state, from the sidebar's row states. */
  prOf: (dir: string) => string | null;
  onWorktree: (w: Worktree) => void;
  /** Enter on the last row: make a workspace named after the query. */
  onCreate: (name: string) => void;
  onClose: () => void;
};

type Row = PaletteItem & { spans: [number, number][] };

/** The worktree rows: with an empty query hidden ones stay out (main checkouts always show); a
 * typed query searches every worktree. */
export function worktreeItems(projects: Project[], lists: Record<string, Worktree[]>, typed: boolean, prOf: Props["prOf"], go: (w: Worktree) => void): PaletteItem[] {
  const out: PaletteItem[] = [];
  for (const p of projects) {
    const ws = (lists[p.id] ?? []).filter((w) => typed || w.isMain || !w.hidden);
    for (const w of ws) out.push({ section: "Worktrees", label: worktreeLabel(w), hint: [p.name, w.branch ?? "detached"].join(" · "), run: () => go(w) });
    const main = ws.find((w) => w.isMain) ?? ws[0];
    if (main) out.push({ section: "Projects", label: p.name, hint: p.path, run: () => go(main) });
    for (const w of ws) {
      const pr = prOf(w.path);
      if (pr && pr !== "suppressed") out.push({ section: "Pull requests", label: `${w.branch ?? worktreeLabel(w)}`, hint: `${pr} pull request · ${p.name}`, run: () => go(w) });
    }
  }
  return out;
}

/** The rows that match every word, in section order, with their highlight ranges. */
export function paletteRows(items: PaletteItem[], query: string): Row[] {
  const words = wordsOf(query);
  const rows: Row[] = [];
  for (const section of SECTIONS)
    for (const it of items) {
      if (it.section !== section) continue;
      const spans = matchWords(it.hint ? `${it.label} ${it.hint}` : it.label, words);
      if (spans) rows.push({ ...it, spans });
    }
  return rows;
}

/** A piece of a row's text with its matches marked; `from` is where the piece starts. */
function Marked({ text, spans, from }: { text: string; spans: [number, number][]; from: number }) {
  const parts: React.ReactNode[] = [];
  let i = 0;
  for (const [a, b] of spans) {
    const s = Math.max(a - from, i);
    const e = Math.min(b - from, text.length);
    if (e <= s) continue;
    if (s > i) parts.push(text.slice(i, s));
    parts.push(<mark key={s}>{text.slice(s, e)}</mark>);
    i = e;
  }
  if (i < text.length) parts.push(text.slice(i));
  return <>{parts}</>;
}

export default function WorktreePalette({ projects, items, prOf, onWorktree, onCreate, onClose }: Props) {
  const [lists, setLists] = useState<Record<string, Worktree[]>>({});
  const [query, setQuery] = useState("");
  const [refused, setRefused] = useState(false);
  const [at, setAt] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      const next: Record<string, Worktree[]> = {};
      for (const p of projects) next[p.id] = await invoke<Worktree[]>("workspace_list", { projectId: p.id }).catch(() => []);
      if (live) setLists(next);
    })();
    return () => {
      live = false;
    };
  }, [projects]);

  const typed = query.trim() !== "";
  const rows = useMemo(() => paletteRows([...items, ...worktreeItems(projects, lists, typed, prOf, onWorktree)], query), [items, projects, lists, query]);
  const create = typed ? query.trim() : null;
  const count = rows.length + (create ? 1 : 0);
  const go = (i: number) => {
    onClose();
    if (i < rows.length) rows[i].run();
    else if (create) onCreate(create);
  };
  const setText = (v: string) => {
    if (v.length > MAX_QUERY) return setRefused(true);
    setRefused(false);
    setQuery(v);
    setAt(0);
  };

  return (
    <>
      <div className="menu-backdrop" onMouseDown={onClose} />
      <div className="menu note-picker palette" role="dialog" aria-label="Switch worktree">
        <input
          autoFocus
          className="picker-input"
          placeholder="Jump to a worktree, tab, project or setting"
          value={query}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "Enter") count > 0 && go(Math.min(at, count - 1));
            else if (e.key === "ArrowDown") setAt((i) => Math.min(i + 1, count - 1));
            else if (e.key === "ArrowUp") setAt((i) => Math.max(i - 1, 0));
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
        />
        {refused && <div className="menu-hint warn">That is too long to search; the palette takes up to {MAX_QUERY} characters.</div>}
        <div className="picker-list" role="listbox">
          {rows.map((r, i) => (
            <Fragment key={`${r.section}|${r.label}|${r.hint ?? ""}|${i}`}>
              {(i === 0 || rows[i - 1].section !== r.section) && <div className="palette-section">{r.section}</div>}
              <button role="option" aria-selected={i === at} className={`menu-item${i === at ? " at" : ""}`} onMouseEnter={() => setAt(i)} onClick={() => go(i)}>
                <span className="name">
                  <Marked text={r.label} spans={r.spans} from={0} />
                </span>
                {r.hint && (
                  <span className="picker-folder">
                    <Marked text={r.hint} spans={r.spans} from={r.label.length + 1} />
                  </span>
                )}
              </button>
            </Fragment>
          ))}
          {create && (
            <>
              {rows.length === 0 && <div className="menu-hint">Nothing matches.</div>}
              <button role="option" aria-selected={at === rows.length} className={`menu-item${at === rows.length ? " at" : ""}`} onMouseEnter={() => setAt(rows.length)} onClick={() => go(rows.length)}>
                <span className="name">Create workspace “{create}”</span>
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
