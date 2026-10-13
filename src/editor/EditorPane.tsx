// An editor tab (EDIT-001): one file in a CodeMirror 6 view, coloured by its language. The text
// lives in a per-file buffer (buffers.ts), so the same file in two split panes is one text; the
// tab is unsaved while that text differs from the disk copy. Mod+S comes from App's shortcut
// router, which calls the focused pane's entry in `editors`. A file that will not load is tried
// three times, then the body says why and offers Retry; a failed save is a toast and the
// marker stays. A markdown file opens in a rich view (EDIT-012, markdown.ts) with a Rich |
// Source switch; the source view is the CodeMirror one, which keeps holding the text throughout.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { basicSetup } from "codemirror";
import { EditorView } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { ChevronDown, Close, FileCode, List } from "../chrome/icons";
import { attach, baseName, detach, isDirty, loadText, relay, save, subscribe } from "./buffers";
import { changeBetween, isMarkdown, mountRich, RICH_LIMIT, unsupported } from "./markdown";
import { domPick, noteDraft, selections } from "./notes";
import { findSupport, openFind } from "./find";
import { conflictColours, conflictField, goConflict } from "./conflicts";
import { useKeymap } from "../keys/KeymapContext";
import { matchEvent } from "../keys/keymap";
import { Contents, FindBar, selectedIn, type FindOpen } from "./NoteTools";
import { replaceInRich } from "./notefind";
import { outline } from "./toc";
import "./editor-extras.css";

/** Save for each open editor pane, by pane key; App's Mod+S calls the focused one. */
export const editors = new Map<number, () => Promise<void>>();

const lang = new Compartment();
export const look = EditorView.theme(
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

/** `readOnly`: typing changes nothing (SKILL-012 previews a kit result this way). */
type Props = { id: number; path: string; readOnly?: boolean; hidden?: boolean; focused?: boolean; onFocus?: () => void; onClose?: () => void; onDirty?: (dirty: boolean) => void; onToast?: (text: string) => void };

export default function EditorPane({ id, path, readOnly = false, hidden = false, focused = false, onFocus, onClose, onDirty, onToast }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [dirty, setDirty] = useState(false);
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
  const [conflicts, setConflicts] = useState(0);
  // EDIT-016 / EDIT-017: the rich view's find bar and contents panel, and the note text they read
  // (taken from the buffer a moment after typing stops).
  const [noteFind, setNoteFind] = useState<FindOpen | null>(null);
  const [toc, setToc] = useState(false);
  const [noteText, setNoteText] = useState("");
  const noteTimer = useRef(0);

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
          extensions: [EditorState.lineSeparator.of(text.includes("\r\n") ? "\r\n" : "\n"), EditorState.readOnly.of(readOnly), basicSetup, look, syntaxHighlighting(oneDarkHighlightStyle), lang.of([]), findSupport, conflictColours, EditorView.updateListener.of((u) => {
            u.transactions.forEach((tr) => relay(path, u.view, tr));
            if (u.docChanged) setConflicts(u.state.field(conflictField).list.length);
            if (u.docChanged && isMarkdown(path)) {
              clearTimeout(noteTimer.current);
              noteTimer.current = window.setTimeout(() => setNoteText(u.state.doc.toString()), 300);
            }
          })],
        });
        view.current = made;
        attach(path, made, text);
        setNoteText(text);
        setReady((n) => n + 1);
        // EDIT-009: a file still holding conflicts opens on the first one.
        setConflicts(made.state.field(conflictField).list.length);
        goConflict(made, 0);
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
      clearTimeout(noteTimer.current);
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
  // EDIT-005 / EDIT-009: find and conflict stepping act on the source view (the rich view's
  // find comes with EDIT-017).
  const sourceShown = !md || mode === "source";
  const keymap = useKeymap();
  const stepConflicts = (dir: 1 | -1) => {
    const cm = view.current;
    if (cm && goConflict(cm, dir)) cm.focus();
  };
  // The user's own chords for editor.find / editor.replace (a rebinding is the one that works;
  // CodeMirror's built-in Mod+F is off) and, with conflicts in the file, editor.nextChange /
  // editor.previousChange. App's router leaves these to the focused editor pane.
  const onKeys = (e: React.KeyboardEvent) => {
    const hit = matchEvent(keymap, e.nativeEvent, ["editor"]);
    const finding = hit?.id === "editor.find" || hit?.id === "editor.replace";
    if (shown === "rich" && finding) {
      // EDIT-017: the rich view's own bar, with replace.
      const replace = hit.id === "editor.replace" && !readOnly;
      if (!e.repeat) setNoteFind((f) => ({ replace, seed: selectedIn(richHost.current), n: (f?.n ?? 0) + 1 }));
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!sourceShown || !view.current) return;
    if (finding) {
      // Holding the chord down does not keep reopening the bar.
      if (!e.repeat) openFind(view.current, hit.id === "editor.replace" && !readOnly);
    } else if ((hit?.id === "editor.nextChange" || hit?.id === "editor.previousChange") && conflicts) stepConflicts(hit.id === "editor.nextChange" ? 1 : -1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const shown = !md || mode === "source" ? "source" : richError ? "error" : "rich";
  const richRoot = useCallback(() => richHost.current, []);
  const hasHeadings = useMemo(() => md && outline(noteText).length > 0, [md, noteText]);
  const tocShown = toc && hasHeadings && shown === "rich";
  // GIT-042: the add-note shortcut reads this tab's selection (Markdown files only).
  useEffect(() => {
    if (!md) return;
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
  return (
    <section className={`pane editor${focused ? " focused" : ""}${tocShown ? " toc-open" : ""}`} hidden={hidden} aria-label={`${name} pane`} onMouseDown={onFocus} onKeyDownCapture={onKeys} data-kind="editor" data-key={id}>
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
        {hasHeadings && shown === "rich" && (
          <button className="ib" aria-pressed={toc} title="Contents" aria-label="Contents" onClick={() => setToc((v) => !v)}>
            <List size={13} />
          </button>
        )}
        {conflicts > 0 && sourceShown && (
          <span className="conflict-nav" role="group" aria-label="Merge conflicts">
            <span className="count">{conflicts === 1 ? "1 conflict" : `${conflicts} conflicts`}</span>
            <button className="ib up" title="Previous conflict (Shift+F7)" aria-label="Previous conflict" onClick={() => stepConflicts(-1)}>
              <ChevronDown size={12} />
            </button>
            <button className="ib" title="Next conflict (F7)" aria-label="Next conflict" onClick={() => stepConflicts(1)}>
              <ChevronDown size={12} />
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
      {noteFind && shown === "rich" && (
        <FindBar pane={id} root={richRoot} open={noteFind} onClose={() => setNoteFind(null)} replace={readOnly ? undefined : (ranges, text) => rich.current && replaceInRich(rich.current.editor, ranges, text)} />
      )}
      {tocShown && <Contents md={noteText} path={path} root={richRoot} onClose={() => setToc(false)} />}
      <div ref={host} className="pane-body" hidden={shown !== "source"} />
      {md && <div ref={richHost} className="pane-body md-rich" contentEditable suppressContentEditableWarning spellCheck hidden={shown !== "rich"} aria-label={`${name}, rich view`} />}
    </section>
  );
}
