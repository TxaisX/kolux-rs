// An editor tab (EDIT-001): one file in a CodeMirror 6 view, coloured by its language. The text
// lives in a per-file buffer (buffers.ts), so the same file in two split panes is one text; the
// tab is unsaved while that text differs from the disk copy. Mod+S comes from App's shortcut
// router, which calls the focused pane's entry in `editors`. A file that will not load is tried
// three times, then the body says why and offers Retry; a failed save is a toast and the
// marker stays. A save is refused when the file changed on disk since it was loaded (EDIT-003,
// T-073-a): the pane then asks Reload (take the disk copy) or Keep mine (overwrite it). A markdown file opens in a rich view (EDIT-012, markdown.ts) with a Rich |
// Source switch; the source view is the CodeMirror one, which keeps holding the text throughout.
// EDIT-007: Copy Context copies the selection under its path and line range, with a hint beside a
// selection it applies to; EDIT-020: review notes take a selection from any file, not just Markdown.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { basicSetup } from "codemirror";
import { EditorView } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { Close, FileCode } from "../chrome/icons";
import { attach, baseName, detach, isDirty, isStale, loadText, relay, replaceAll, save, subscribe } from "./buffers";
import { changeBetween, isMarkdown, mountRich, RICH_LIMIT, unsupported } from "./markdown";
import { domPick, noteDraft, selections } from "./notes";
import { contextText } from "./copyContext";
import { shortPath } from "./diffNotes";
import { useLabel } from "../keys/KeymapContext";

/** Save for each open editor pane, by pane key; App's Mod+S calls the focused one. */
export const editors = new Map<number, () => Promise<void>>();
/** EDIT-007: Copy Context for each open editor pane; false when this tab cannot copy that way. */
export const copiers = new Map<number, () => boolean>();

const lang = new Compartment();
export const look = EditorView.theme(
  {
    "&": { height: "100%", background: "var(--pane-bg)", color: "var(--fg)", fontSize: "13px" },
    // TERM-097 / SET-018: the editor font, which is the terminal font unless set on its own.
    ".cm-scroller": { fontFamily: "var(--editor-font, var(--mono-font))", lineHeight: "1.5" },
    ".cm-gutters": { background: "var(--pane-bg)", color: "var(--fg-faint)", border: "none" },
    // See-through, so the selection drawn under the text still shows on the caret's line.
    ".cm-activeLine, .cm-activeLineGutter": { background: "color-mix(in srgb, var(--row-selected) 45%, transparent)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { background: "color-mix(in srgb, var(--line-focus) 90%, transparent) !important" },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor": { borderLeftColor: "var(--fg)" },
  },
  { dark: true },
);

/** `readOnly`: typing changes nothing (SKILL-012 previews a kit result this way). */
type Props = { id: number; path: string; root?: string | null; readOnly?: boolean; hidden?: boolean; focused?: boolean; onFocus?: () => void; onClose?: () => void; onDirty?: (dirty: boolean) => void; onToast?: (text: string) => void };

export default function EditorPane({ id, path, root = null, readOnly = false, hidden = false, focused = false, onFocus, onClose, onDirty, onToast }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [stale, setStale] = useState(false); // the last save was refused: the disk copy moved on
  const report = useRef({ onDirty, onToast });
  report.current = { onDirty, onToast };
  const wantFocus = useRef(focused);
  wantFocus.current = focused;
  const md = isMarkdown(path);
  const richHost = useRef<HTMLDivElement>(null);
  const rich = useRef<ReturnType<typeof mountRich> | null>(null);
  const [ready, setReady] = useState(0); // counts loads, so the rich view starts after each one
  const [mode, setMode] = useState<"rich" | "source">(md ? "rich" : "source");
  const [banner, setBanner] = useState<{ text: string; big?: boolean } | null>(null);
  const [bigOk, setBigOk] = useState(false); // Open anyway, for this tab and this file only
  const [richError, setRichError] = useState<string | null>(null);
  const [richTries, setRichTries] = useState(0);
  // EDIT-007: the hint beside a selection Copy Context applies to, gone once that selection is copied.
  const copyKey = useLabel("editor.copyContext").join("+");
  const [hint, setHint] = useState<{ x: number; y: number; sel: string } | null>(null);
  const [copiedSel, setCopiedSel] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ x: number; y: number } | null>(null);
  const place = useRef((_v: EditorView) => {});
  place.current = (v) => {
    const { from, to } = v.state.selection.main;
    const c = from !== to && v.hasFocus ? v.coordsAtPos(to) : null;
    setHint(c && contextText(v.state.doc, from, to, "").header ? { x: c.right, y: c.bottom, sel: `${from}-${to}` } : null);
  };

  useEffect(() => {
    let alive = true;
    let made: EditorView | null = null;
    const off = subscribe(path, () => {
      const d = isDirty(path);
      setDirty(d);
      report.current.onDirty?.(d);
    });
    setError(null);
    setStale(false);
    loadText(() => invoke<string>("file_read", { path })).then(
      (text) => {
        if (!alive) return;
        made = new EditorView({
          doc: text,
          parent: host.current!,
          // A file with Windows line ends is saved with them.
          extensions: [EditorState.lineSeparator.of(text.includes("\r\n") ? "\r\n" : "\n"), EditorState.readOnly.of(readOnly), basicSetup, look, syntaxHighlighting(oneDarkHighlightStyle), lang.of([]), EditorView.updateListener.of((u) => u.transactions.forEach((tr) => relay(path, u.view, tr))), EditorView.updateListener.of((u) => (u.selectionSet || u.docChanged || u.focusChanged || u.geometryChanged) && place.current(u.view)), EditorView.domEventHandlers({ scroll: (_e, v) => void place.current(v) })],
        });
        view.current = made;
        attach(path, made, text);
        setReady((n) => n + 1);
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
        await save(path, (text, loadedHash) => invoke("file_write", { path, text, loadedHash }));
        setStale(false);
      } catch (err) {
        if (isStale(err)) return setStale(true);
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

  // A new file in this tab starts over: rich again, and Open anyway forgotten.
  useEffect(() => {
    setMode(isMarkdown(path) ? "rich" : "source");
    setBigOk(false);
    setBanner(null);
  }, [path]);

  // EDIT-012: the rich view, started over the source text whenever the tab switches to it.
  useEffect(() => {
    const cm = view.current;
    if (!md || mode !== "rich" || !ready || !cm || !richHost.current) return;
    setRichError(null);
    const text = cm.state.doc.toString();
    const fallBack = (b: { text: string; big?: boolean }) => {
      setBanner(b);
      setMode("source");
    };
    if (text.length > RICH_LIMIT && !bigOk) return fallBack({ text: `This file is ${(text.length / 1048576).toFixed(1)} MB, so it opened in source view.`, big: true });
    const why = unsupported(text);
    if (why) return fallBack({ text: `Showing source: the rich view cannot show this file because ${why}.` });
    let pushed = text;
    try {
      rich.current = mountRich(richHost.current, text, (out) => {
        const now = cm.state.doc.toString();
        // The rich view drops the file's last line end; keep it.
        const next = now.endsWith("\n") && !out.endsWith("\n") ? out + "\n" : out;
        const change = changeBetween(now, next);
        pushed = next;
        if (change) cm.dispatch({ changes: change, userEvent: "input" });
      });
    } catch (err) {
      setRichError(String(err));
      return;
    }
    setBanner(null);
    const r = rich.current;
    if (wantFocus.current) r.editor.focus();
    // Text changed elsewhere (a twin pane, a reload) is shown afresh.
    const off = subscribe(path, () => {
      const now = cm.state.doc.toString();
      if (now !== pushed) r.show((pushed = now));
    });
    return () => {
      off();
      r.destroy();
      rich.current = null;
    };
  }, [md, mode, ready, bigOk, richTries, path]);

  useEffect(() => {
    if (!focused || hidden) return;
    if (rich.current) rich.current.editor.focus();
    else view.current?.focus();
  }, [focused, hidden]);

  const name = baseName(path);
  const shown = !md || mode === "source" ? "source" : richError ? "error" : "rich";
  // GIT-042, EDIT-020: the add-note shortcut reads this tab's selection, in any file.
  useEffect(() => {
    selections.set(id, () => {
      const cm = view.current;
      if (!cm) return null;
      if (shown === "rich") return domPick(richHost.current, path, cm.state.doc.toString());
      const { from, to } = cm.state.selection.main;
      const draft = noteDraft(path, "", cm.state.sliceDoc(from, to), cm.state.doc.lineAt(from).number);
      const at = cm.coordsAtPos(to);
      return draft && { draft, x: at?.left ?? 200, y: at?.bottom ?? 200 };
    });
    return () => void selections.delete(id);
  }, [md, id, path, shown]);
  useEffect(() => {
    copiers.set(id, () => {
      const cm = view.current;
      if (!cm || shown !== "source") return false;
      const { from, to } = cm.state.selection.main;
      const c = cm.coordsAtPos(to);
      navigator.clipboard.writeText(contextText(cm.state.doc, from, to, shortPath(path, root)).text).then(
        () => {
          setCopiedSel(`${from}-${to}`);
          setFlash(c ? { x: c.right, y: c.bottom } : null);
          setTimeout(() => setFlash(null), 1500);
        },
        (err) => report.current.onToast?.(`Nothing was copied: ${String(err)}`),
      );
      return true;
    });
    return () => void copiers.delete(id);
  }, [id, path, root, shown]);
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
        {md && (
          <span className="view-switch" role="group" aria-label="View">
            <button aria-pressed={mode === "rich"} onClick={() => setMode("rich")} title="Rich view">
              Rich
            </button>
            <button
              aria-pressed={mode === "source"}
              onClick={() => {
                setMode("source");
                setBanner(null);
              }}
              title="Source view"
            >
              Source
            </button>
          </span>
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
          {error.includes("outside your projects") && (
            <button className="btn" title="Allows this one file for this run; nothing beneath it" onClick={() => void invoke("file_grant", { path }).then(() => setTries((n) => n + 1), (err) => setError(String(err)))}>
              Open this file anyway
            </button>
          )}
        </div>
      )}
      {stale && (
        <div className="notice save-stale" role="alert">
          {name} changed on disk since you opened it, so it was not saved.
          <button
            className="btn"
            title="Show the disk copy; your unsaved edits are dropped"
            onClick={() =>
              void invoke<string>("file_read", { path }).then(
                (text) => {
                  replaceAll(path, text);
                  setStale(false);
                },
                (err) => report.current.onToast?.(name + " did not reload: " + String(err)),
              )
            }
          >
            Reload
          </button>
          <button
            className="btn"
            title="Save your text over the disk copy"
            onClick={() =>
              void save(path, (text) => invoke("file_write", { path, text }), true).then(
                () => setStale(false),
                (err) => report.current.onToast?.(name + " was not saved: " + String(err)),
              )
            }
          >
            Keep mine
          </button>
        </div>
      )}
      {banner && (
        <div className="notice md-banner" role="status">
          {banner.text}
          {banner.big && (
            <button
              className="btn"
              onClick={() => {
                setBigOk(true);
                setMode("rich");
              }}
            >
              Open anyway
            </button>
          )}
        </div>
      )}
      {shown === "error" && (
        <div className="notice load-failed" role="alert">
          The rich view did not start: {richError}
          <button className="btn" onClick={() => setRichTries((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}
      <div ref={host} className="pane-body" hidden={shown !== "source"} />
      {!hidden && shown === "source" && hint && copyKey && copiedSel !== hint.sel && !flash && (
        <div className="copy-hint" style={{ left: hint.x + 8, top: hint.y + 2 }}>
          {copyKey} copies with path and lines
        </div>
      )}
      {!hidden && flash && (
        <div className="copy-hint done" role="status" style={{ left: flash.x + 8, top: flash.y + 2 }}>
          Copied with path and lines
        </div>
      )}
      {md && <div ref={richHost} className="pane-body md-rich" contentEditable suppressContentEditableWarning spellCheck hidden={shown !== "rich"} aria-label={`${name}, rich view`} />}
    </section>
  );
}
