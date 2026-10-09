// An editor tab (EDIT-001): one file in a CodeMirror 6 view, coloured by its language. The text
// lives in a per-file buffer (buffers.ts), so the same file in two split panes is one text; the
// tab is unsaved while that text differs from the disk copy. Mod+S comes from App's shortcut
// router, which calls the focused pane's entry in `editors`. A file that will not load is tried
// three times, then the body says why and offers Retry; a failed save is a toast and the
// marker stays.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { basicSetup } from "codemirror";
import { EditorView } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { Close, FileCode } from "../chrome/icons";
import { attach, baseName, detach, isDirty, loadText, relay, save, subscribe } from "./buffers";

/** Save for each open editor pane, by pane key; App's Mod+S calls the focused one. */
export const editors = new Map<number, () => Promise<void>>();

const lang = new Compartment();
const look = EditorView.theme(
  {
    "&": { height: "100%", background: "var(--pane-bg)", color: "var(--fg)", fontSize: "13px" },
    ".cm-scroller": { fontFamily: "var(--mono-font)", lineHeight: "1.5" },
    ".cm-gutters": { background: "var(--pane-bg)", color: "var(--fg-faint)", border: "none" },
    // See-through, so the selection drawn under the text still shows on the caret's line.
    ".cm-activeLine, .cm-activeLineGutter": { background: "color-mix(in srgb, var(--row-selected) 45%, transparent)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { background: "color-mix(in srgb, var(--line-focus) 90%, transparent) !important" },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor": { borderLeftColor: "var(--fg)" },
  },
  { dark: true },
);

type Props = { id: number; path: string; hidden?: boolean; focused?: boolean; onFocus?: () => void; onClose?: () => void; onDirty?: (dirty: boolean) => void; onToast?: (text: string) => void };

export default function EditorPane({ id, path, hidden = false, focused = false, onFocus, onClose, onDirty, onToast }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [dirty, setDirty] = useState(false);
  const report = useRef({ onDirty, onToast });
  report.current = { onDirty, onToast };
  const wantFocus = useRef(focused);
  wantFocus.current = focused;

  useEffect(() => {
    let alive = true;
    let made: EditorView | null = null;
    const off = subscribe(path, () => {
      const d = isDirty(path);
      setDirty(d);
      report.current.onDirty?.(d);
    });
    setError(null);
    loadText(() => invoke<string>("file_read", { path })).then(
      (text) => {
        if (!alive) return;
        made = new EditorView({
          doc: text,
          parent: host.current!,
          // A file with Windows line ends is saved with them.
          extensions: [EditorState.lineSeparator.of(text.includes("\r\n") ? "\r\n" : "\n"), basicSetup, look, syntaxHighlighting(oneDarkHighlightStyle), lang.of([]), EditorView.updateListener.of((u) => u.transactions.forEach((tr) => relay(path, u.view, tr)))],
        });
        view.current = made;
        attach(path, made, text);
        // A newly opened file takes the keyboard at once.
        if (wantFocus.current) made.focus();
        LanguageDescription.matchFilename(languages, baseName(path))
          ?.load()
          .then((support) => alive && made?.dispatch({ effects: lang.reconfigure(support) }))
          .catch(() => undefined);
      },
      (err) => alive && setError(String(err)),
    );
    editors.set(id, async () => {
      try {
        await save(path, (text) => invoke("file_write", { path, text }));
      } catch (err) {
        report.current.onToast?.(`${baseName(path)} was not saved: ${String(err)}`);
      }
    });
    return () => {
      alive = false;
      editors.delete(id);
      off();
      if (made) {
        detach(path, made);
        made.destroy();
      }
      view.current = null;
    };
  }, [id, path, tries]);

  useEffect(() => {
    if (focused && !hidden) view.current?.focus();
  }, [focused, hidden]);

  const name = baseName(path);
  return (
    <section className={`pane editor${focused ? " focused" : ""}`} hidden={hidden} aria-label={`${name} pane`} onMouseDown={onFocus} data-kind="editor" data-key={id}>
      <header className="pane-head">
        <span className="agent-mark" title="File">
          <FileCode size={13} />
        </span>
        <span className="title">{name}</span>
        {dirty && <span className="unsaved" title="Unsaved changes" aria-label="Unsaved changes" />}
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
      <div ref={host} className="pane-body" />
    </section>
  );
}
