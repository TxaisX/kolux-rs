// A diff tab (EDIT-027): one file's staged or unstaged change, inline or in two columns. It starts
// inline, with whitespace-only changes hidden and long lines unwrapped; the actions menu turns
// either on. F7 and Shift+F7 (App's shortcut router, `diffNav`) step through the changes. An
// unstaged diff's right side is the working file itself, kept in the shared buffer (buffers.ts), so
// it can be edited and Mod+S writes the file. The sides are read again every two seconds while the
// tab is in front, so a change made in a terminal, or a stage made elsewhere, shows without
// reopening. A markdown file's diff is source text, never the rich view.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { basicSetup } from "codemirror";
import { EditorView } from "@codemirror/view";
import { ChangeSet, Compartment, EditorState, type Extension } from "@codemirror/state";
import { LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { diff, getChunks, getOriginalDoc, goToNextChunk, goToPreviousChunk, MergeView, originalDocChangeEffect, unifiedMergeView } from "@codemirror/merge";
import { ChevronDown, Close, Dots, FileCode } from "../chrome/icons";
import { attach, baseName, detach, isDirty, relay, replaceAll, save, subscribe, textOf } from "./buffers";
import { editors, look } from "./EditorPane";
import { watchAutosave } from "./autosave";

/** Next (1) or previous (-1) change, by pane key; App's F7 and Shift+F7 call the focused one. */
export const diffNav = new Map<number, (dir: 1 | -1) => void>();

type Sides = { original: string; modified: string };

const squash = (s: string) => s.replace(/\s+/g, "");
/** The diff with whitespace-only changes left out, which is how a diff tab starts. */
export const withoutWhitespace = (a: string, b: string) => diff(a, b).filter((c) => squash(a.slice(c.fromA, c.toA)) !== squash(b.slice(c.fromB, c.toB)));

type Props = { id: number; path: string; staged: boolean; hidden?: boolean; focused?: boolean; onFocus?: () => void; onClose?: () => void; onDirty?: (dirty: boolean) => void; onToast?: (text: string) => void; autosave?: number | null };

export default function DiffPane({ id, path, staged, hidden = false, focused = false, onFocus, onClose, onDirty, onToast, autosave = null }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [sides, setSides] = useState<Sides | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [split, setSplit] = useState(false);
  const [spaces, setSpaces] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [menu, setMenu] = useState(false);
  const [changes, setChanges] = useState(0);
  const [dirty, setDirty] = useState(false);
  const views = useRef<{ a: EditorView | null; b: EditorView } | null>(null);
  const shown = useRef<Sides | null>(null); // the sides the views were last given
  const report = useRef({ onDirty, onToast });
  report.current = { onDirty, onToast };
  const front = useRef(!hidden);
  front.current = !hidden;
  const lang = useRef(new Compartment());
  const ready = sides !== null;

  // The sides, now and every two seconds while the tab is in front.
  useEffect(() => {
    let alive = true;
    setError(null);
    const fetch = () =>
      invoke<Sides>("diff_sides", { path, staged }).then(
        (s) => alive && setSides((old) => (old && old.original === s.original && old.modified === s.modified ? old : s)),
        (err) => alive && setError(String(err)),
      );
    void fetch();
    // ponytail: a 2 s poll stands in for a git status watcher; swap in Source Control's watcher once it exists
    const t = window.setInterval(() => front.current && void fetch(), 2000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [path, staged, tries]);

  // The views, built again when the layout or a menu option changes.
  useEffect(() => {
    if (!ready || !host.current) return;
    const s = shown.current ?? sides!;
    const modified = (!staged && textOf(path)) || s.modified;
    shown.current = { original: s.original, modified: s.modified };
    const common: Extension[] = [basicSetup, look, syntaxHighlighting(oneDarkHighlightStyle), lang.current.of([]), wrap ? EditorView.lineWrapping : []];
    const count = (st: EditorState) => setChanges(getChunks(st)?.chunks.length ?? 0);
    const right: Extension[] = [
      ...common,
      EditorState.lineSeparator.of(modified.includes("\r\n") ? "\r\n" : "\n"),
      staged ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
      EditorView.updateListener.of((u) => {
        count(u.state);
        if (!staged) u.transactions.forEach((tr) => relay(path, u.view, tr));
      }),
    ];
    const diffConfig = spaces ? undefined : { override: withoutWhitespace };
    let a: EditorView | null = null;
    let b: EditorView;
    let merge: MergeView | null = null;
    if (split) {
      merge = new MergeView({ a: { doc: s.original, extensions: [...common, EditorState.readOnly.of(true), EditorView.editable.of(false)] }, b: { doc: modified, extensions: right }, parent: host.current, gutter: true, diffConfig });
      a = merge.a;
      b = merge.b;
    } else {
      b = new EditorView({ doc: modified, parent: host.current, extensions: [...right, unifiedMergeView({ original: s.original, mergeControls: false, gutter: true, diffConfig })] });
    }
    views.current = { a, b };
    count(b.state);
    if (!staged) attach(path, b, s.modified);
    LanguageDescription.matchFilename(languages, baseName(path))
      ?.load()
      .then((support) => [a, b].forEach((v) => v?.dispatch({ effects: lang.current.reconfigure(support) })))
      .catch(() => undefined);
    return () => {
      if (!staged) detach(path, b);
      views.current = null;
      if (merge) merge.destroy();
      else b.destroy();
    };
  }, [ready, split, spaces, wrap, path, staged]);

  // New sides from git: the left side always follows; the right one does unless it has unsaved edits.
  useEffect(() => {
    const v = views.current;
    const old = shown.current;
    if (!v || !old || !sides) return;
    shown.current = sides;
    if (sides.original !== old.original) {
      const len = (v.a ?? v.b).state.doc.length;
      if (v.a) v.a.dispatch({ changes: { from: 0, to: len, insert: sides.original } });
      else {
        const was = getOriginalDoc(v.b.state);
        v.b.dispatch({ effects: originalDocChangeEffect(v.b.state, ChangeSet.of({ from: 0, to: was.length, insert: sides.original }, was.length)) });
      }
    }
    if (sides.modified !== old.modified) {
      if (!staged) {
        if (!isDirty(path)) replaceAll(path, sides.modified);
      } else v.b.dispatch({ changes: { from: 0, to: v.b.state.doc.length, insert: sides.modified } });
    }
  }, [sides, path, staged]);

  // Unsaved marker and Mod+S, for an unstaged diff.
  useEffect(() => {
    if (staged) return;
    const off = subscribe(path, () => {
      const d = isDirty(path);
      setDirty(d);
      report.current.onDirty?.(d);
    });
    editors.set(id, async () => {
      try {
        await save(path, (text) => invoke("file_write", { path, text }));
      } catch (err) {
        report.current.onToast?.(`${baseName(path)} was not saved: ${String(err)}`);
      }
    });
    return () => {
      off();
      editors.delete(id);
    };
  }, [id, path, staged]);

  // EDIT-002: an unstaged diff's right side is the working file, so autosave covers it; a staged
  // diff is read-only and never autosaves.
  useEffect(() => {
    if (staged || !ready || autosave === null) return;
    return watchAutosave(
      path,
      autosave,
      (text) => invoke("file_write", { path, text }),
      () => invoke<string>("file_read", { path }),
      () => report.current.onToast?.(`${baseName(path)} changed on disk, so autosave left it alone. Save to keep your edits.`),
      (err) => report.current.onToast?.(`${baseName(path)} was not saved: ${String(err)}`),
    );
  }, [staged, ready, autosave, path]);

  useEffect(() => {
    diffNav.set(id, (dir) => {
      const b = views.current?.b;
      if (!b) return;
      (dir > 0 ? goToNextChunk : goToPreviousChunk)(b);
      b.focus();
    });
    return () => void diffNav.delete(id);
  }, [id]);

  useEffect(() => {
    if (focused && !hidden) views.current?.b.focus();
  }, [focused, hidden, ready]);

  const name = baseName(path);
  const step = (dir: 1 | -1) => diffNav.get(id)?.(dir);
  return (
    <section className={`pane editor diff${focused ? " focused" : ""}`} hidden={hidden} aria-label={`Diff of ${name}`} onMouseDown={onFocus} data-kind="diff" data-key={id}>
      <header className="pane-head">
        <span className="agent-mark" title="Diff">
          <FileCode size={13} />
        </span>
        <span className="title">{name}</span>
        <span className="preview-tag">{staged ? "Staged" : "Unstaged"}</span>
        {dirty && <span className="unsaved" title="Unsaved changes" aria-label="Unsaved changes" />}
        <span className="path" title={path}>
          {path}
        </span>
        <span className="view-switch" role="group" aria-label="Layout">
          <button aria-pressed={!split} onClick={() => setSplit(false)} title="Inline">
            Inline
          </button>
          <button aria-pressed={split} onClick={() => setSplit(true)} title="Side by side">
            Side by side
          </button>
        </span>
        <span className="right">
          <button className="ib" disabled={!changes} onClick={() => step(-1)} title="Previous change (Shift+F7)" aria-label="Previous change">
            <ChevronDown size={12} style={{ transform: "rotate(180deg)" }} />
          </button>
          <button className="ib" disabled={!changes} onClick={() => step(1)} title="Next change (F7)" aria-label="Next change">
            <ChevronDown size={12} />
          </button>
          <span className="diff-actions">
            <button className="ib" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)} title="Diff actions" aria-label="Diff actions">
              <Dots size={12} />
            </button>
            {menu && (
              <>
                <div className="menu-backdrop" onMouseDown={() => setMenu(false)} />
                <div className="menu diff-menu" role="menu">
                  <button role="menuitemcheckbox" aria-checked={spaces} className="menu-item" onClick={() => setSpaces((v) => !v)}>
                    <span className="check">{spaces ? "✓" : ""}</span>
                    <span className="name">Show whitespace changes</span>
                  </button>
                  <button role="menuitemcheckbox" aria-checked={wrap} className="menu-item" onClick={() => setWrap((v) => !v)}>
                    <span className="check">{wrap ? "✓" : ""}</span>
                    <span className="name">Wrap lines</span>
                  </button>
                </div>
              </>
            )}
          </span>
          <button className="ib" onClick={onClose} title="Close tab (Ctrl+W)">
            <Close size={12} />
          </button>
        </span>
      </header>
      {error && (
        <div className="notice load-failed" role="alert">
          The diff of {name} did not load: {error}
          <button className="btn" onClick={() => setTries((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}
      {ready && !changes && <div className="notice md-banner" role="status">No {staged ? "staged" : "unstaged"} changes in this file right now.</div>}
      <div ref={host} className="pane-body diff-body" />
    </section>
  );
}
