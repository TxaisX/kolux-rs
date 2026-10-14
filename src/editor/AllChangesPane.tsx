// All Changes (EDIT-029): every changed file of a worktree in one scroll, one section per file and
// side (a file with staged and unstaged changes has two). A section keeps an estimated height until
// it scrolls near, then fetches its two sides and draws them inline; one over WAIT_OVER changed
// lines waits for a click, images load as pictures, other binaries are only named. Fetched sides
// are reused only while the change's stamp (git's blob ids, plus size and time for the working
// file) is the same. The side tree starts hidden; it can be resized, filtered and used to jump and
// to tick files off as viewed. Changes are read again whenever git state moves (the git status
// watcher, scm/watch.ts) while the tab is in front, or when it comes back to the front after one.
// GIT-038 (T-033-c): the tab also measures the branch against its base (the merge-base snapshot,
// so the base moving on changes nothing), with a commit box while it does; inline or side by
// side, wrapped lines, whitespace-only changes and the tree each start from a setting and toggle
// per tab; every section folds, and all at once. GIT-037: a section's "open as tab" button opens
// the file's diff tab in the split chosen in Source Control.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { basicSetup } from "codemirror";
import { EditorView } from "@codemirror/view";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { ChevronDown, Close, FileCode, List } from "../chrome/icons";
import { baseName } from "./buffers";
import { look } from "./EditorPane";
import { withoutWhitespace } from "./DiffPane";
import { watchStatus } from "../scm/watch";
import { useSettings } from "../settings/useSettings";
import { AC_SPLIT_KEY, AC_TREE_KEY, AC_WHITESPACE_KEY, AC_WRAP_KEY, acLayoutOf, canCommit, isCommitShortcut, type AcLayout, type CommitOutcome, type Status } from "../scm/model";

export type Entry = { path: string; staged: boolean; code: string; lines: number | null; binary: boolean; stamp: string };
/** The base a branch is measured against and the snapshot commit the sides are read from. */
export type Base = { against: string; since: string };
type BaseChanges = Base & { entries: Entry[] };
type Sides = { original: string; modified: string };
type Cache = Map<string, { stamp: string; sides: Sides }>;
type Draw = Pick<AcLayout, "split" | "wrap" | "spaces">;

/** A section with more changed lines than this waits for a click before it draws. */
export const WAIT_OVER = 2000;
const LINE = 19.5; // px, the editor's 13 px text at line height 1.5
const CEILING = 560; // px, the most a text section may take before it scrolls inside itself
const IMAGE = /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i;

export const entryKey = (e: Entry) => `${e.staged ? "s" : "u"}|${e.path}`;
/** The height a section reserves before it draws, so the scroll does not jump. */
export const estimate = (e: Entry) => {
  const n = e.lines ?? 0;
  if (IMAGE.test(e.path) || e.binary) return 48;
  if (n > WAIT_OVER) return 64;
  // An untracked file shows whole (plus the empty last line); a change shows some context around it.
  return Math.min(CEILING, e.code === "?" ? (n + 1) * LINE + 8 : (n + 8) * LINE);
};
/** The word on a section: which side of the index a working-tree change is on, or against the
 * base what became of the file. */
export const tagOf = (e: Entry, base: boolean) => (base ? (e.code === "A" ? "Added" : e.code === "D" ? "Deleted" : e.code === "?" ? "Untracked" : "Changed") : e.code === "?" ? "Untracked" : e.staged ? "Staged" : "Unstaged");
/** The command and arguments a section reads its two texts with. */
export const sidesCall = (base: Base | null, root: string, e: Entry): [string, Record<string, unknown>] => (base ? ["scm_base_sides", { worktree: root, path: e.path, since: base.since }] : ["diff_sides", { path: e.path, staged: e.staged }]);

type Props = { id: number; root: string; hidden?: boolean; focused?: boolean; onFocus?: () => void; onClose?: () => void; onOpenDiff?: (path: string, staged: boolean) => void; pinnedBase?: string | null };

export default function AllChangesPane({ id, root, hidden = false, focused = false, onFocus, onClose, onOpenDiff, pinnedBase = null }: Props) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"tree" | "base">("tree");
  const [base, setBase] = useState<Base | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState("");
  const [outcome, setOutcome] = useState<{ text: string; bad: boolean } | null>(null);
  const { settings, save } = useSettings();
  const [over, setOver] = useState<Partial<AcLayout>>({}); // this tab's toggles over the saved defaults
  const layout: AcLayout = { ...acLayoutOf(settings), ...over };
  const [fold, setFold] = useState<Record<string, boolean>>({});
  const [width, setWidth] = useState(260);
  const [filter, setFilter] = useState("");
  const [viewed, setViewed] = useState<Record<string, string>>({}); // key: the stamp it was viewed at
  const [ready, setReady] = useState<Record<string, string>>({}); // key: the stamp it has drawn
  const cache = useRef<Cache>(new Map());
  const list = useRef<HTMLDivElement>(null);
  const top = useRef(0);
  const front = useRef(!hidden);
  front.current = !hidden;

  const missed = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!hidden && missed.current) {
      const f = missed.current;
      missed.current = null;
      f();
    }
  }, [hidden]);
  useEffect(() => {
    let alive = true;
    const read = mode === "base" ? () => invoke<BaseChanges>("scm_base_changes", { worktree: root, pinned: pinnedBase }).then((b) => (setBase({ against: b.against, since: b.since }), b.entries)) : () => invoke<Entry[]>("change_entries", { root }).then((es) => (setBase(null), es));
    const fetch = () =>
      read().then(
        (es) => {
          if (!alive) return;
          setError(null);
          setEntries((old) => (old && JSON.stringify(old) === JSON.stringify(es) ? old : es));
        },
        (err) => alive && setError(String(err)),
      );
    void fetch();
    const stop = watchStatus(root, (s) => {
      setStatus(s);
      if (front.current) void fetch();
      else missed.current = () => void fetch();
    });
    return () => {
      alive = false;
      missed.current = null;
      stop();
    };
  }, [root, mode, pinnedBase]);

  // Coming back to the tab puts the scroll where it was.
  useEffect(() => {
    if (!hidden && list.current) list.current.scrollTop = top.current;
  }, [hidden]);

  const rel = (p: string) => p.slice(root.length).replace(/^[\\/]+/, "").replace(/\\/g, "/");
  const shown = useMemo(() => {
    const q = filter.toLowerCase();
    return (entries ?? []).map((e, i) => ({ e, i })).filter(({ e }) => rel(e.path).toLowerCase().includes(q));
  }, [entries, filter, root]);
  const sectionId = (i: number) => `ac-${id}-${i}`;
  const onReady = (key: string, stamp: string | null) =>
    setReady((r) => {
      if ((r[key] ?? null) === stamp) return r;
      const next = { ...r };
      if (stamp === null) delete next[key];
      else next[key] = stamp;
      return next;
    });
  const isViewed = (e: Entry) => viewed[entryKey(e)] === e.stamp && ready[entryKey(e)] === e.stamp;
  const toggleViewed = (e: Entry) => {
    const k = entryKey(e);
    if (ready[k] !== e.stamp) return; // still loading or waiting for a click: not viewable yet
    setViewed((v) => {
      const next = { ...v };
      if (next[k] === e.stamp) delete next[k];
      else next[k] = e.stamp;
      return next;
    });
  };
  // Sections near the target draw while the jump lands and change height, so the jump is made
  // again a few times until they settle, unless the user scrolls first.
  const jump = (anchor: string) => {
    const go = () => document.getElementById(anchor)?.scrollIntoView({ block: "start" });
    const l = list.current;
    let n = 0;
    const stop = () => {
      window.clearInterval(t);
      l?.removeEventListener("wheel", stop);
      l?.removeEventListener("pointerdown", stop);
    };
    const t = window.setInterval(() => (++n > 8 ? stop() : go()), 100);
    l?.addEventListener("wheel", stop, { passive: true });
    l?.addEventListener("pointerdown", stop);
    go();
  };
  const resize = (down: React.PointerEvent) => {
    const x0 = down.clientX;
    const w0 = width;
    const move = (m: PointerEvent) => setWidth(Math.max(160, Math.min(640, w0 + m.clientX - x0)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const commit = () => {
    if (!canCommit(status, message)) return;
    invoke<CommitOutcome>("scm_commit", { worktree: root, message }).then(
      (out) => {
        if (out.id) {
          setMessage("");
          setOutcome({ text: `Committed ${out.id}`, bad: false });
        } else setOutcome({ text: `${out.blocked ? "Commit blocked by a hook" : "Commit failed"}: ${out.output}`, bad: true });
      },
      (e) => setOutcome({ text: String(e), bad: true }),
    );
  };
  const foldAll = (on: boolean) => setFold(Object.fromEntries((entries ?? []).map((e) => [entryKey(e), on])));
  const allFolded = (entries?.length ?? 0) > 0 && (entries ?? []).every((e) => fold[entryKey(e)]);
  const toggle = (k: keyof Draw | "tree") => setOver((o) => ({ ...o, [k]: !layout[k] }));
  const draw: Draw = { split: layout.split, wrap: layout.wrap, spaces: layout.spaces };

  const count = entries?.length ?? 0;
  const done = (entries ?? []).filter(isViewed).length;
  return (
    <section className={`pane editor all-changes${focused ? " focused" : ""}`} hidden={hidden} aria-label="All Changes" onMouseDown={onFocus} data-kind="changes" data-key={id} tabIndex={-1}>
      <header className="pane-head">
        <span className="agent-mark" title="All Changes">
          <FileCode size={13} />
        </span>
        <span className="title">All Changes</span>
        <span className="preview-tag">
          {count} {count === 1 ? "file" : "files"}
          {count ? ` · ${done} viewed` : ""}
        </span>
        <span className="path" title={root}>
          {root}
        </span>
        <span className="right ac-opts">
          <select className="ac-mode" aria-label="Compare" title="What the changes are measured against" value={mode} onChange={(e) => setMode(e.target.value as "tree" | "base")}>
            <option value="tree">Working tree</option>
            <option value="base">{base ? `Branch vs ${base.against}` : "Branch vs base"}</option>
          </select>
          <label className="ac-opt" title="Two columns instead of one">
            <input type="checkbox" checked={layout.split} onChange={() => toggle("split")} aria-label="Side by side" /> Side by side
          </label>
          <label className="ac-opt" title="Wrap long lines">
            <input type="checkbox" checked={layout.wrap} onChange={() => toggle("wrap")} aria-label="Wrap lines" /> Wrap
          </label>
          <label className="ac-opt" title="Show changes that only move whitespace">
            <input type="checkbox" checked={layout.spaces} onChange={() => toggle("spaces")} aria-label="Show whitespace changes" /> Whitespace
          </label>
          <button className="link" onClick={() => void save({ [AC_SPLIT_KEY]: layout.split, [AC_WRAP_KEY]: layout.wrap, [AC_WHITESPACE_KEY]: layout.spaces, [AC_TREE_KEY]: layout.tree })} title="New All Changes tabs start with this layout">
            Make default
          </button>
          <button className="link" onClick={() => foldAll(!allFolded)} disabled={!count} aria-label={allFolded ? "Expand all" : "Collapse all"}>
            {allFolded ? "Expand all" : "Collapse all"}
          </button>
          <button className="ib" aria-pressed={layout.tree} onClick={() => toggle("tree")} title={layout.tree ? "Hide the file tree" : "Show the file tree"} aria-label="File tree">
            <List size={12} />
          </button>
          <button className="ib" onClick={onClose} title="Close tab (Ctrl+W)">
            <Close size={12} />
          </button>
        </span>
      </header>
      {error && (
        <div className="notice load-failed" role="alert">
          The changes did not load: {error}. They are read again when git state moves.
        </div>
      )}
      {mode === "base" && (
        <div className="scm-commit ac-commit" aria-label="Commit">
          <textarea className="field multi" aria-label="Commit message" placeholder={status?.branch ? `Message (Ctrl+Enter to commit on ${status.branch})` : "Message (Ctrl+Enter to commit)"} value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => isCommitShortcut(e) && (e.preventDefault(), commit())} />
          <div className="ac-commit-row">
            <button className="btn" disabled={!canCommit(status, message)} onClick={commit} title={status && status.staged.length === 0 ? "Nothing is staged" : status && status.conflicts.length ? "Conflicts remain" : undefined}>
              Commit{status?.staged.length ? ` ${status.staged.length} staged` : ""}
            </button>
            {outcome && (
              <span className={`note${outcome.bad ? " warn" : ""}`} role="status">
                {outcome.text}
              </span>
            )}
          </div>
        </div>
      )}
      <div className="pane-body ac-body">
        {layout.tree && (
          <aside className="ac-tree" style={{ width }} aria-label="Changed files">
            <input className="picker-input" placeholder="Filter by name" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter changed files" />
            <div className="ac-rows">
              {shown.map(({ e, i }, n) => {
                const dir = rel(e.path).split("/").slice(0, -1).join("/");
                const prev = n > 0 ? rel(shown[n - 1].e.path).split("/").slice(0, -1).join("/") : null;
                return (
                  <div key={entryKey(e)}>
                    {dir !== prev && dir && <div className="ac-dir">{dir}</div>}
                    <div className="ac-row">
                      <input type="checkbox" checked={isViewed(e)} disabled={ready[entryKey(e)] !== e.stamp} onChange={() => toggleViewed(e)} aria-label={`Viewed ${rel(e.path)}`} />
                      <button className="ac-jump" onClick={() => jump(sectionId(i))} title={rel(e.path)}>
                        {baseName(e.path)}
                      </button>
                      <span className="ac-code" title={tagOf(e, base !== null)}>{tagOf(e, base !== null)}</span>
                    </div>
                  </div>
                );
              })}
              {entries && !shown.length && <div className="menu-hint">{count ? "No changed file matches." : "No changes."}</div>}
            </div>
          </aside>
        )}
        {layout.tree && <div className="ac-handle" onPointerDown={resize} role="separator" aria-orientation="vertical" aria-label="Resize the file tree" />}
        <div className="ac-list" ref={list} onScroll={(e) => (top.current = e.currentTarget.scrollTop)}>
          {entries === null && !error && <div className="menu-hint">Reading the changes…</div>}
          {entries && !entries.length && <div className="menu-hint">{base ? `This branch has no changes against ${base.against}.` : "This worktree has no changes."}</div>}
          {(entries ?? []).map((e, i) => (
            <Section key={entryKey(e)} anchor={sectionId(i)} e={e} name={rel(e.path)} root={root} base={base} draw={draw} cache={cache.current} scroller={list} onReady={onReady} viewed={isViewed(e)} canView={ready[entryKey(e)] === e.stamp} onViewed={() => toggleViewed(e)} folded={!!fold[entryKey(e)]} onFold={() => setFold((f) => ({ ...f, [entryKey(e)]: !f[entryKey(e)] }))} onOpen={onOpenDiff && base === null ? () => onOpenDiff(e.path, e.staged) : undefined} />
          ))}
        </div>
      </div>
    </section>
  );
}

type SectionProps = { anchor: string; e: Entry; name: string; root: string; base: Base | null; draw: Draw; cache: Cache; scroller: React.RefObject<HTMLDivElement | null>; onReady: (key: string, stamp: string | null) => void; viewed: boolean; canView: boolean; onViewed: () => void; folded: boolean; onFold: () => void; onOpen?: () => void };

const Section = memo(function Section({ anchor, e, name, root, base, draw, cache, scroller, onReady, viewed, canView, onViewed, folded, onFold, onOpen }: SectionProps) {
  const key = entryKey(e);
  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [go, setGo] = useState(false);
  const [sides, setSides] = useState<Sides | null>(null);
  const [pics, setPics] = useState<{ old: string | null; now: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Against the base an image has no "before" to show: it is named like a binary.
  const kind = IMAGE.test(e.path) && !base ? "image" : e.binary || (IMAGE.test(e.path) && base) ? "binary" : "text";
  const waits = kind === "text" && (e.lines ?? 0) > WAIT_OVER && !go;

  // Sections load as they come near the visible part of the list.
  useEffect(() => {
    const el = box.current;
    if (!el || near) return;
    const io = new IntersectionObserver((seen) => seen.some((s) => s.isIntersecting) && setNear(true), { root: scroller.current, rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near || waits) return;
    let alive = true;
    setError(null);
    if (kind === "binary") {
      onReady(key, e.stamp);
      return;
    }
    onReady(key, null);
    if (kind === "image") {
      const url = (bytes: ArrayBuffer) => (bytes.byteLength ? URL.createObjectURL(new Blob([bytes], { type: /\.svg$/i.test(e.path) ? "image/svg+xml" : "" })) : null);
      const made: string[] = [];
      Promise.all([invoke<ArrayBuffer>("diff_image", { path: e.path, staged: e.staged, new: false }), invoke<ArrayBuffer>("diff_image", { path: e.path, staged: e.staged, new: true })]).then(
        ([a, b]) => {
          if (!alive) return;
          const p = { old: url(a), now: url(b) };
          made.push(...[p.old, p.now].filter((u): u is string => !!u));
          setPics(p);
          onReady(key, e.stamp);
        },
        (err) => alive && setError(String(err)),
      );
      return () => {
        alive = false;
        made.forEach((u) => URL.revokeObjectURL(u));
      };
    }
    const hit = cache.get(key);
    if (hit && hit.stamp === e.stamp) setSides(hit.sides);
    else {
      const [cmd, args] = sidesCall(base, root, e);
      invoke<Sides>(cmd, args).then(
        (s) => {
          if (!alive) return;
          cache.set(key, { stamp: e.stamp, sides: s });
          setSides(s);
        },
        (err) => alive && setError(String(err)),
      );
    }
    return () => {
      alive = false;
    };
  }, [near, waits, e.stamp, kind, base?.since]);

  // The diff, drawn again whenever new sides arrive, the layout changes or the section unfolds.
  useEffect(() => {
    if (!sides || !host.current || folded) return;
    const lang = new Compartment();
    const common: Extension[] = [basicSetup, look, syntaxHighlighting(oneDarkHighlightStyle), lang.of([]), EditorState.readOnly.of(true), EditorView.editable.of(false), draw.wrap ? EditorView.lineWrapping : []];
    const diffConfig = draw.spaces ? undefined : { override: withoutWhitespace };
    const collapseUnchanged = { margin: 3, minSize: 6 };
    let views: EditorView[];
    let merge: MergeView | null = null;
    if (draw.split) {
      merge = new MergeView({ a: { doc: sides.original, extensions: common }, b: { doc: sides.modified, extensions: common }, parent: host.current, gutter: true, collapseUnchanged, diffConfig });
      views = [merge.a, merge.b];
    } else {
      views = [new EditorView({ doc: sides.modified, parent: host.current, extensions: [...common, unifiedMergeView({ original: sides.original, mergeControls: false, gutter: true, collapseUnchanged, diffConfig })] })];
    }
    LanguageDescription.matchFilename(languages, baseName(e.path))
      ?.load()
      .then((support) => views.forEach((v) => v.dispatch({ effects: lang.reconfigure(support) })))
      .catch(() => undefined);
    onReady(key, e.stamp);
    return () => {
      if (merge) merge.destroy();
      else views.forEach((v) => v.destroy());
    };
  }, [sides, draw.split, draw.wrap, draw.spaces, folded]);

  const drawn = (kind === "text" && sides) || (kind === "image" && pics) || (kind === "binary" && near);
  return (
    <div className="ac-section" id={anchor} ref={box} data-key={key} data-folded={folded || undefined}>
      <div className="ac-head">
        <button className="ib" onClick={onFold} aria-expanded={!folded} aria-label={folded ? `Expand ${name}` : `Collapse ${name}`} title={folded ? "Expand" : "Collapse"} style={folded ? { transform: "rotate(-90deg)" } : undefined}>
          <ChevronDown size={12} />
        </button>
        <input type="checkbox" checked={viewed} disabled={!canView} onChange={onViewed} title={canView ? "Mark as viewed" : "Not loaded yet"} aria-label={`Viewed ${name}`} />
        <span className="ac-name" title={e.path}>
          {name}
        </span>
        <span className="preview-tag">{tagOf(e, base !== null)}</span>
        {e.lines !== null && <span className="ac-lines">{e.lines} changed {e.lines === 1 ? "line" : "lines"}</span>}
        {onOpen && (
          <button className="ib" onClick={onOpen} title="Open as a diff tab, in the split chosen in Source Control" aria-label={`Open ${name} as a tab`}>
            <FileCode size={12} />
          </button>
        )}
      </div>
      {error && (
        <div className="notice load-failed" role="alert">
          This file's diff did not load: {error}
        </div>
      )}
      {folded ? null : waits ? (
        <div className="ac-wait">
          {e.lines} changed lines.
          <button className="btn" onClick={() => setGo(true)}>
            Load diff
          </button>
        </div>
      ) : kind === "binary" ? (
        <div className="ac-wait">{base && IMAGE.test(e.path) ? "Image; against the base only its name is shown." : "Binary file; its contents are not shown."}</div>
      ) : kind === "image" ? (
        pics ? (
          <div className="ac-images">
            <figure>
              <figcaption>Before</figcaption>
              {pics.old ? <img src={pics.old} alt={`${name} before`} /> : <span className="menu-hint">Not there</span>}
            </figure>
            <figure>
              <figcaption>After</figcaption>
              {pics.now ? <img src={pics.now} alt={`${name} after`} /> : <span className="menu-hint">Removed</span>}
            </figure>
          </div>
        ) : (
          <div style={{ height: estimate(e) }} />
        )
      ) : (
        <div className="ac-editor" ref={host} style={drawn ? undefined : { height: estimate(e) }} />
      )}
    </div>
  );
});
