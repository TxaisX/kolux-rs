// A markdown preview tab (EDIT-012, Mod+Shift+V): the file rendered read-only, with "Preview" in
// its header. It follows the open text of the file live when an editor has it, else the disk copy.
// The HTML is sanitised (DOMPurify) and links do not navigate, so nothing in a note can take over
// the app's window. Front matter shows as its own block above the note (EDIT-019); More actions
// hides or shows it for each note, shown at first and remembered across restarts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { Close, Dots, FileCode, List } from "../chrome/icons";
import { baseName, keyOf, subscribe, textOf } from "./buffers";
import { splitFront } from "./markdown";

const HIDE_KEY = "kolux.preview.frontHidden";
const hiddenFronts = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(HIDE_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};
const rememberFront = (path: string, hide: boolean) => {
  try {
    const rest = hiddenFronts().filter((k) => k !== keyOf(path));
    localStorage.setItem(HIDE_KEY, JSON.stringify(hide ? [...rest, keyOf(path)] : rest));
  } catch {
    // Not remembered this time; the note still hides or shows now.
  }
};
import { domPick, selections } from "./notes";
import { Contents, FindBar, selectedIn, type FindOpen } from "./NoteTools";
import { outline } from "./toc";
import { useKeymap } from "../keys/KeymapContext";
import { matchEvent } from "../keys/keymap";
import "./editor-extras.css";

type Props = { id: number; path: string; hidden?: boolean; focused?: boolean; onFocus?: () => void; onClose?: () => void };

export const renderMarkdown = (md: string) => DOMPurify.sanitize(marked.parse(md, { async: false }));

export default function PreviewPane({ id, path, hidden = false, focused = false, onFocus, onClose }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [menu, setMenu] = useState(false);
  const [frontOff, setFrontOff] = useState(() => hiddenFronts().includes(keyOf(path)));
  useEffect(() => setFrontOff(hiddenFronts().includes(keyOf(path))), [path]);
  // EDIT-017 / EDIT-016: the find bar and the contents panel.
  const [find, setFind] = useState<FindOpen | null>(null);
  const [toc, setToc] = useState(false);
  const page = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const root = useCallback(() => page.current, []);
  const keymap = useKeymap();
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
  const { front, body } = splitFront(text ?? "");
  const toggleFront = () => {
    rememberFront(path, !frontOff);
    setFrontOff(!frontOff);
    setMenu(false);
  };
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
          <span className="diff-actions">
            <button className="ib" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)} title="More actions" aria-label="More actions">
              <Dots size={12} />
            </button>
            {menu && (
              <>
                <div className="menu-backdrop" onMouseDown={() => setMenu(false)} />
                <div className="menu diff-menu" role="menu">
                  <button role="menuitemcheckbox" aria-checked={!frontOff} className="menu-item" disabled={!front} onClick={toggleFront}>
                    <span className="check">{front && !frontOff ? "✓" : ""}</span>
                    <span className="name">{front ? "Show front matter" : "No front matter in this note"}</span>
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
          if ((e.target as HTMLElement).closest("a")) e.preventDefault();
        }}
      >
        {front && !frontOff && (
          <pre className="md-front" aria-label="Front matter">
            {front.trimEnd()}
          </pre>
        )}
        <div dangerouslySetInnerHTML={{ __html: text === null ? "" : renderMarkdown(body) }} />
      </div>
    </section>
  );
}
