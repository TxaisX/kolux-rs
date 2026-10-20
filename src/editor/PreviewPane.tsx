// A markdown preview tab (EDIT-012, Mod+Shift+V): the file rendered read-only, with "Preview" in
// its header. It follows the open text of the file live when an editor has it, else the disk copy.
// The HTML is sanitised (DOMPurify) and links do not navigate, so nothing in a note can take over
// the app's window.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { Close, FileCode, List } from "../chrome/icons";
import { baseName, subscribe, textOf } from "./buffers";
import { domPick, selections } from "./notes";
import { Contents, FindBar, selectedIn, type FindOpen } from "./NoteTools";
import { outline } from "./toc";
import { followClick, type LinkHandler } from "./linkClicks";
import { drawDiagrams, loadRenderers, renderNote, watchRenderers } from "./diagrams";
import { useKeymap } from "../keys/KeymapContext";
import { matchEvent } from "../keys/keymap";
import "./editor-extras.css";

type Props = { id: number; path: string; hidden?: boolean; focused?: boolean; onFocus?: () => void; onClose?: () => void; worktree?: string | null; onLink?: LinkHandler };

export const renderMarkdown = (md: string) => DOMPurify.sanitize(marked.parse(md, { async: false }));

export default function PreviewPane({ id, path, hidden = false, focused = false, onFocus, onClose, worktree = null, onLink }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  // EDIT-017 / EDIT-016: the find bar and the contents panel.
  const [find, setFind] = useState<FindOpen | null>(null);
  const [toc, setToc] = useState(false);
  const page = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const root = useCallback(() => page.current, []);
  const keymap = useKeymap();
  // EDIT-029 / EDIT-030: diagrams and maths draw once the libraries are plugged in (diagrams.ts).
  const [libs, setLibs] = useState(0);
  useEffect(() => {
    void loadRenderers();
    return watchRenderers(() => setLibs((n) => n + 1));
  }, []);
  const html = useMemo(() => (text === null ? "" : renderNote(text, renderMarkdown)), [text, libs]);
  useEffect(() => {
    let alive = true;
    if (page.current) void drawDiagrams(page.current, true, () => alive);
    return () => {
      alive = false;
    };
  }, [html]);
  const hasHeadings = useMemo(() => outline(text ?? "").length > 0, [text]);

  useEffect(() => {
    let alive = true;
    setError(null);
    const open = textOf(path);
    if (open !== null) setText(open);
    else
      invoke<string>("file_read", { path }).then(
        (t) => alive && setText(t),
        (err) => alive && setError(String(err)),
      );
    const off = subscribe(path, () => {
      const t = textOf(path);
      if (t !== null) setText(t);
    });
    return () => {
      alive = false;
      off();
    };
  }, [path, tries]);

  // GIT-042: the add-note shortcut reads the selection in the rendered page.
  useEffect(() => {
    selections.set(id, () => domPick(document.querySelector(`.pane.preview[data-key="${id}"] .md-preview`), path, text ?? ""));
    return () => void selections.delete(id);
  }, [id, path, text]);

  // A preview opened from the explorer or Quick Open takes the keyboard, so Mod+F answers at once.
  useEffect(() => {
    if (focused && !hidden && !section.current?.contains(document.activeElement)) section.current?.focus();
  }, [focused, hidden]);

  // The user's own find chords (editor.find and editor.replace both open find: a preview has
  // nothing to replace).
  const onKeys = (e: React.KeyboardEvent) => {
    const hit = matchEvent(keymap, e.nativeEvent, ["editor"]);
    if (hit?.id !== "editor.find" && hit?.id !== "editor.replace") return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) setFind((f) => ({ replace: false, seed: selectedIn(page.current), n: (f?.n ?? 0) + 1 }));
  };

  const name = baseName(path);
  return (
    <section ref={section} className={`pane editor preview${focused ? " focused" : ""}${toc && hasHeadings ? " toc-open" : ""}`} hidden={hidden} aria-label={`Preview of ${name}`} onMouseDown={onFocus} onKeyDownCapture={onKeys} data-kind="preview" data-key={id} tabIndex={-1}>
      <header className="pane-head">
        <span className="agent-mark" title="Markdown preview">
          <FileCode size={13} />
        </span>
        <span className="title">{name}</span>
        <span className="preview-tag">Preview</span>
        <span className="path" title={path}>
          {path}
        </span>
        {hasHeadings && (
          <button className="ib" aria-pressed={toc} title="Contents" aria-label="Contents" onClick={() => setToc((v) => !v)}>
            <List size={13} />
          </button>
        )}
        <span className="right">
          <button className="ib" onClick={onClose} title="Close tab (Ctrl+W)">
            <Close size={12} />
          </button>
        </span>
      </header>
      {error && (
        <div className="notice load-failed" role="alert">
          {name} did not open: {error}
          <button className="btn" onClick={() => setTries((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}
      {find && <FindBar pane={id} root={root} open={find} onClose={() => (setFind(null), section.current?.focus())} />}
      {toc && hasHeadings && <Contents md={text ?? ""} path={path} root={root} onClose={() => setToc(false)} />}
      <div
        ref={page}
        className="pane-body md-preview"
        aria-readonly="true"
        onClick={(e) => {
          // EDIT-014: Mod+click follows a link; a plain click never navigates.
          if (followClick(e.nativeEvent, e.currentTarget, path, worktree, onLink)) return;
          if ((e.target as HTMLElement).closest("a")) e.preventDefault();
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </section>
  );
}
