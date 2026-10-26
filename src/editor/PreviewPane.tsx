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
import { hideFrontFor, splitFront } from "./frontMatter";
import { FrontMatterBlock } from "../shell/MdViewControls";
import { frontControl } from "../shell/mdView";
import { mdPrefs, setMdPrefs } from "../shell/mdPrefs";
import { followClick, type LinkHandler } from "./linkClicks";
import { drawDiagrams, loadRenderers, renderNote, watchRenderers } from "./diagrams";
import { filterDataPictures } from "./notePictures";
import { showPicturesIn } from "./pictureDom";
import { useKeymap } from "../keys/KeymapContext";
import { matchEvent } from "../keys/keymap";
import "./editor-extras.css";

type Props = { id: number; path: string; hidden?: boolean; focused?: boolean; onFocus?: () => void; onClose?: () => void; worktree?: string | null; onLink?: LinkHandler };

// EDIT-009: an inline data picture over the size limit, not a picture type or damaged is left out (notePictures.ts)
export const renderMarkdown = (md: string) => filterDataPictures(DOMPurify.sanitize(marked.parse(md, { async: false })));

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
  // EDIT-019 (row 94): front matter is its own block above the note, shown at first and remembered per file (VIEW-113); the page below is the body.
  const { front, body } = useMemo(() => splitFront(text ?? ""), [text]);
  // The choice is held with its path and saved on the click, so a pane moved to another file reads that file's own choice.
  const [held, setHeld] = useState({ path, hide: false });
  const hideFront = hideFrontFor(held, path, (p) => mdPrefs(p).hideFront);
  const toggleFront = () => {
    setHeld({ path, hide: !hideFront });
    setMdPrefs(path, { hideFront: !hideFront });
  };
  const frontCtl = frontControl(front, hideFront);
  const html = useMemo(() => (text === null ? "" : renderNote(body, renderMarkdown)), [text, body, libs]);
  useEffect(() => {
    let alive = true;
    if (page.current) void drawDiagrams(page.current, true, () => alive);
    return () => {
      alive = false;
    };
  }, [html]);
  // EDIT-009: the note's own pictures (beside it on disk) are read through the file fence and shown as they scroll in.
  useEffect(() => (page.current ? showPicturesIn(page.current, path) : undefined), [html, path]);
  const hasHeadings = useMemo(() => outline(body).length > 0, [body]);

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
        {frontCtl && (
          <button className="ib" aria-pressed={frontCtl.pressed} title={frontCtl.label} aria-label={frontCtl.label} onClick={toggleFront}>
            Front
          </button>
        )}
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
      {toc && hasHeadings && <Contents md={body} path={path} root={root} onClose={() => setToc(false)} />}
      <FrontMatterBlock front={front} hide={hideFront} />
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
