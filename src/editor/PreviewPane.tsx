// A markdown preview tab (EDIT-012, Mod+Shift+V): the file rendered read-only, with "Preview" in
// its header. It follows the open text of the file live when an editor has it, else the disk copy.
// The HTML is sanitised (DOMPurify) and links do not navigate, so nothing in a note can take over
// the app's window.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { Close, FileCode } from "../chrome/icons";
import { baseName, subscribe, textOf } from "./buffers";

type Props = { id: number; path: string; hidden?: boolean; focused?: boolean; onFocus?: () => void; onClose?: () => void };

export const renderMarkdown = (md: string) => DOMPurify.sanitize(marked.parse(md, { async: false }));

export default function PreviewPane({ id, path, hidden = false, focused = false, onFocus, onClose }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);

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
        dangerouslySetInnerHTML={{ __html: text === null ? "" : renderMarkdown(text) }}
      />
    </section>
  );
}
