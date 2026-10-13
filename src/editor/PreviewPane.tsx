// A markdown preview tab (EDIT-012, Mod+Shift+V): the file rendered read-only, with "Preview" in
// its header. It follows the open text of the file live when an editor has it, else the disk copy.
// The HTML is sanitised (DOMPurify) and links do not navigate, so nothing in a note can take over
// the app's window. Front matter shows as its own block above the note (EDIT-019); More actions
// hides or shows it for each note, shown at first and remembered across restarts.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { Close, Dots, FileCode } from "../chrome/icons";
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

type Props = { id: number; path: string; hidden?: boolean; focused?: boolean; onFocus?: () => void; onClose?: () => void };

export const renderMarkdown = (md: string) => DOMPurify.sanitize(marked.parse(md, { async: false }));

export default function PreviewPane({ id, path, hidden = false, focused = false, onFocus, onClose }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [menu, setMenu] = useState(false);
  const [frontOff, setFrontOff] = useState(() => hiddenFronts().includes(keyOf(path)));
  useEffect(() => setFrontOff(hiddenFronts().includes(keyOf(path))), [path]);

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

  const name = baseName(path);
  const { front, body } = splitFront(text ?? "");
  const toggleFront = () => {
    rememberFront(path, !frontOff);
    setFrontOff(!frontOff);
    setMenu(false);
  };
  return (
    <section className={`pane editor preview${focused ? " focused" : ""}`} hidden={hidden} aria-label={`Preview of ${name}`} onMouseDown={onFocus} data-kind="preview" data-key={id} tabIndex={-1}>
      <header className="pane-head">
        <span className="agent-mark" title="Markdown preview">
          <FileCode size={13} />
        </span>
        <span className="title">{name}</span>
        <span className="preview-tag">Preview</span>
        <span className="path" title={path}>
          {path}
        </span>
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
      <div
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
