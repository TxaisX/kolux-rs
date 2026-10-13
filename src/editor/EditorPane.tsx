// An editor tab (EDIT-001): one file in a CodeMirror 6 view, coloured by its language. The text
// lives in a per-file buffer (buffers.ts), so the same file in two split panes is one text; the
// tab is unsaved while that text differs from the disk copy. Mod+S comes from App's shortcut
// router, which calls the focused pane's entry in `editors`. A file that will not load is tried
// three times, then the body says why and offers Retry; a failed save is a toast and the
// marker stays. A markdown file opens in a rich view (EDIT-012, markdown.ts) with a Rich |
// Source switch; the source view is the CodeMirror one, which keeps holding the text throughout.
// EDIT-003: a tab on show looks at its file every 1.5 s; a new disk copy is taken quietly when
// there are no unsaved edits, and raises a banner (Reload, Keep my edits, Compare) when there are.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { basicSetup } from "codemirror";
import { EditorView } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { undo } from "@codemirror/commands";
import { MergeView } from "@codemirror/merge";
import { LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { Close, FileCode } from "../chrome/icons";
import { attach, baseName, detach, diskNews, draftOf, isDirty, keyOf, keepMine, loadText, relay, replaceAll, save, subscribe } from "./buffers";
import { changeBetween, isMarkdown, mountRich, planRich, rewrite, RICH_LIMIT, splitFront, unsupported } from "./markdown";
import { resumeAutosave, stopAutosave, watchAutosave } from "./autosave";
import { hashText, type Mode, type Start } from "./session";

/** EDIT-004: each editor pane's caret and view mode, by pane key, kept with the session. */
export const looks = new Map<number, { caret: number; mode: Mode }>();

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

type Props = { id: number; path: string; hidden?: boolean; focused?: boolean; onFocus?: () => void; onClose?: () => void; onDirty?: (dirty: boolean) => void; onToast?: (text: string) => void; autosave?: number | null; start?: Start; movedFrom?: string };

export default function EditorPane({ id, path, hidden = false, focused = false, onFocus, onClose, onDirty, onToast, autosave = null, start, movedFrom }: Props) {
  // EDIT-004: a restored tab's draft, caret and view mode, used by its first load only.
  const first = useRef(start);
  // EDIT-032: what the tab held when its file last closed in it; a rename or move (movedFrom) takes it along.
  const left = useRef<(Start & { from: string }) | null>(null);
  const carried = () => (movedFrom && left.current?.from === keyOf(movedFrom) ? left.current : undefined);
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
  const [mode, setMode] = useState<Mode>(md ? (start?.mode ?? "rich") : "source");
  const modeNow = useRef(mode);
  modeNow.current = mode;
  const [banner, setBanner] = useState<{ text: string; big?: boolean } | null>(null);
  const [bigOk, setBigOk] = useState(false); // Open anyway, for this tab and this file only
  const [richError, setRichError] = useState<string | null>(null);
  const [richTries, setRichTries] = useState(0);
  // EDIT-003: the disk copy that moved under unsaved edits, the Compare view, the undo offer.
  const [moved, setMoved] = useState<string | null>(null);
  const [compare, setCompare] = useState<{ disk: string | null; error?: string } | null>(null);
  const [undoOffer, setUndoOffer] = useState(false);
  const stamp = useRef<string | null>(null);
  const reads = useRef(0);
  const compareHost = useRef<HTMLDivElement>(null);

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
        const begin = first.current ?? carried();
        first.current = undefined;
        left.current = null;
        const doc = begin?.draft ?? text;
        made = new EditorView({
          doc,
          selection: begin?.caret !== undefined ? { anchor: Math.min(begin.caret, doc.length) } : undefined,
          parent: host.current!,
          // A file with Windows line ends is saved with them.
          extensions: [EditorState.lineSeparator.of(text.includes("\r\n") ? "\r\n" : "\n"), basicSetup, look, syntaxHighlighting(oneDarkHighlightStyle), lang.of([]), EditorView.updateListener.of((u) => {
              u.transactions.forEach((tr) => relay(path, u.view, tr));
              looks.set(id, { caret: u.state.selection.main.head, mode: modeNow.current });
            }),
          ],
        });
        view.current = made;
        stamp.current = null;
        attach(path, made, text);
        looks.set(id, { caret: made.state.selection.main.head, mode: modeNow.current });
        // EDIT-003 after a restart: a draft whose file moved on meanwhile gets the banner.
        if (begin?.draft !== undefined && begin.base !== undefined && begin.base !== hashText(text) && isDirty(path)) {
          stopAutosave(path);
          setMoved(text);
        }
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
        await save(path, (text) => invoke("file_write", { path, text }));
        setMoved(null); // saving over a moved disk copy is keeping the edits
        resumeAutosave(path);
      } catch (err) {
        report.current.onToast?.(`${baseName(path)} was not saved: ${String(err)}`);
      }
    });
    return () => {
      alive = false;
      editors.delete(id);
      looks.delete(id);
      off();
      if (made) {
        // Every keystroke up to this moment, so typing while a move finishes is kept.
        const d = draftOf(path);
        left.current = { from: keyOf(path), draft: d?.text, base: d ? hashText(d.disk) : undefined, caret: made.state.selection.main.head, mode: modeNow.current };
        detach(path, made);
        made.destroy();
      }
      view.current = null;
    };
  }, [id, path, tries]);

  useEffect(() => {
    const l = looks.get(id);
    if (l) l.mode = mode;
  }, [id, mode]);

  // A new file in this tab starts over: rich again, and Open anyway forgotten.
  // Only a change of file: the first file keeps a restored mode.
  const lastPath = useRef(path);
  useEffect(() => {
    if (lastPath.current === path) return;
    lastPath.current = path;
    setMode(isMarkdown(path) ? (carried()?.mode ?? "rich") : "source");
    setBigOk(false);
    setBanner(null);
    setMoved(null);
    setCompare(null);
    setUndoOffer(false);
  }, [path]);

  // EDIT-003: while the tab is on show its file's stamp is looked at every 1.5 s and the file is
  // read only when the stamp moves; a background tab looks when it is next brought forward.
  // ponytail: polling, not a file watcher; a watcher (notify crate) if many tabs make it costly.
  useEffect(() => {
    if (!ready || hidden) return;
    let alive = true;
    const peek = async () => {
      const s = await invoke<string>("file_stamp", { path }).catch(() => null);
      if (!alive || s === null || s === stamp.current) return;
      stamp.current = s;
      const seq = ++reads.current;
      const text = await invoke<string>("file_read", { path }).catch(() => null);
      // A read that finishes after a newer one started is thrown away.
      if (!alive || text === null || seq !== reads.current) return;
      const news = diskNews(path, text);
      if (news === "take") replaceAll(path, text);
      else if (news === "conflict") {
        stopAutosave(path); // EDIT-002: autosave never writes over the outside edit
        setMoved(text);
      }
    };
    void peek();
    const t = window.setInterval(() => void peek(), 1500);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [ready, hidden, path]);

  // EDIT-002: autosave, when it is switched on, while the file is open in this tab.
  useEffect(() => {
    if (!ready || autosave === null) return;
    return watchAutosave(
      path,
      autosave,
      (text) => invoke("file_write", { path, text }),
      () => invoke<string>("file_read", { path }),
      (disk) => setMoved(disk),
      (err) => report.current.onToast?.(`${baseName(path)} was not saved: ${String(err)}`),
    );
  }, [ready, autosave, path]);

  useEffect(() => {
    if (!undoOffer) return;
    const t = window.setTimeout(() => setUndoOffer(false), 8000);
    return () => window.clearTimeout(t);
  }, [undoOffer]);

  // EDIT-003 Compare: the disk copy on the left, the buffer on the right.
  useEffect(() => {
    const cm = view.current;
    if (!compare || compare.disk === null || !cm || !compareHost.current) return;
    const ro = [basicSetup, look, syntaxHighlighting(oneDarkHighlightStyle), EditorState.readOnly.of(true), EditorView.editable.of(false)];
    const m = new MergeView({ a: { doc: compare.disk, extensions: ro }, b: { doc: cm.state.sliceDoc(), extensions: ro }, parent: compareHost.current, gutter: true });
    return () => m.destroy();
  }, [compare]);

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
    // EDIT-019: the rich view shows the body without its front matter, and each edit is written
    // back over the file's own bytes, so only the blocks it touched change.
    let plan = planRich(text);
    const lost = () => fallBack({ text: "Showing source: the rich view could not match its blocks to the file." });
    if (!plan) return lost();
    const bodyOf = (t: string) => splitFront(t).body.replace(/\r\n/g, "\n");
    try {
      rich.current = mountRich(richHost.current, bodyOf(text), (out) => {
        const now = cm.state.doc.toString();
        const next = plan ? rewrite(plan, out) : now;
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
      if (now === pushed) return;
      pushed = now;
      plan = planRich(now);
      if (plan) r.show(bodyOf(now));
      else lost();
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

  // Reload always reads the file afresh; the swap is one undo step, offered back in a notice.
  const reload = async () => {
    const seq = ++reads.current;
    try {
      const text = await invoke<string>("file_read", { path });
      if (seq !== reads.current) return;
      replaceAll(path, text);
      setMoved(null);
      resumeAutosave(path);
      setCompare(null);
      setUndoOffer(true);
    } catch (err) {
      report.current.onToast?.(`${baseName(path)} could not be read: ${String(err)}`);
    }
  };
  const keep = () => {
    const disk = compare?.disk ?? moved;
    if (disk !== null) keepMine(path, disk);
    setMoved(null);
    resumeAutosave(path);
    setCompare(null);
  };
  const openCompare = () =>
    invoke<string>("file_read", { path }).then(
      (disk) => setCompare({ disk }),
      (err) => setCompare({ disk: null, error: String(err) }),
    );

  const name = baseName(path);
  const shown = !md || mode === "source" ? "source" : richError ? "error" : "rich";
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
      {moved !== null && !compare && (
        <div className="notice disk-moved" role="alert">
          {name} changed on disk while you have unsaved edits.
          <button className="btn" onClick={() => void reload()}>
            Reload
          </button>
          <button className="btn" onClick={keep}>
            Keep my edits
          </button>
          <button className="btn" onClick={() => void openCompare()}>
            Compare
          </button>
        </div>
      )}
      {undoOffer && (
        <div className="notice disk-undo" role="status">
          Reloaded {name} from disk.
          <button
            className="btn"
            onClick={() => {
              if (view.current) undo(view.current);
              setUndoOffer(false);
            }}
          >
            Undo
          </button>
        </div>
      )}
      {compare && (
        <div className="disk-compare" role="dialog" aria-label={`Compare ${name}`}>
          <div className="disk-compare-head">
            <span>On disk</span>
            <span>Your edits</span>
            <button className="btn" onClick={() => void reload()}>
              Reload
            </button>
            <button className="btn" onClick={keep}>
              Keep my edits
            </button>
          </div>
          {compare.disk === null ? (
            <div className="notice load-failed" role="alert">
              The disk copy could not be read: {compare.error}
            </div>
          ) : (
            <div ref={compareHost} className="pane-body diff-body" />
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
      <div ref={host} className="pane-body" hidden={shown !== "source" || !!compare} />
      {md && <div ref={richHost} className="pane-body md-rich" contentEditable suppressContentEditableWarning spellCheck hidden={shown !== "rich" || !!compare} aria-label={`${name}, rich view`} />}
    </section>
  );
}
