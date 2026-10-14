// An editor tab (EDIT-001): one file in a CodeMirror 6 view, coloured by its language. The text
// lives in a per-file buffer (buffers.ts), so the same file in two split panes is one text; the
// tab is unsaved while that text differs from the disk copy. Mod+S comes from App's shortcut
// router, which calls the focused pane's entry in `editors`. A file that will not load is tried
// three times, then the body says why and offers Retry; a failed save is a toast and the
// marker stays. A save is refused when the file changed on disk since it was loaded (EDIT-003,
// T-073-a): the pane then asks Reload (take the disk copy) or Keep mine (overwrite it). Before any
// save, a cheap check (diskChange.ts, every 2 s for a tab in front and on window focus) notices
// that the file moved on (T-073): a tab without edits takes the disk copy quietly, one with edits
// shows the banner (DiskBanner.tsx: Reload, undoable / Keep my edits / Compare). The check is
// advisory; the save's hash check stays the guard. A markdown file opens in a rich view (EDIT-012, markdown.ts) with a Rich |
// Source switch; the source view is the CodeMirror one, which keeps holding the text throughout.
// EDIT-007: Copy Context copies the selection under its path and line range, with a hint beside a
// selection it applies to; EDIT-020: review notes take a selection from any file, not just Markdown.
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { basicSetup } from "codemirror";
import { EditorView } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { Close, FileCode } from "../chrome/icons";
import { undo } from "@codemirror/commands";
import { attach, baseName, detach, draftOf, isDirty, isStale, keyOf, loadText, relay, replaceAll, save, subscribe, textOf } from "./buffers";
import { beginSave, canUndo, checkOnce, endSave, forget, keep, POLL_MS, readFresh, reloadNow, remember, setBanner as markBanner, UNDO_TOAST_MS, type Io, type Stamp, type UndoEntry } from "./diskChange";
import { CompareView, DiskBanner, UndoToast } from "./DiskBanner";
import { changeBetween, isMarkdown, mountRich, planRich, rewrite, RICH_LIMIT, splitFront, unsupported } from "./markdown";
import { domPick, noteDraft, selections } from "./notes";
import { contextText } from "./copyContext";
import { shortPath } from "./diffNotes";
import { useLabel } from "../keys/KeymapContext";
import { resumeAutosave, stopAutosave, watchAutosave } from "./autosave";
import { hashText, type Mode, type Start } from "./session";

/** EDIT-004: each editor pane's caret and view mode, by pane key, kept with the session. */
export const looks = new Map<number, { caret: number; mode: Mode }>();

/** Save for each open editor pane, by pane key; App's Mod+S calls the focused one. */
export const editors = new Map<number, () => Promise<void>>();
/** EDIT-007: Copy Context for each open editor pane; false when this tab cannot copy that way. */
export const copiers = new Map<number, () => boolean>();

/** EDIT-003 (T-073-a, T-073-c): Mod+S for an editor tab or an unstaged diff tab. The write carries
 *  the hash of the disk copy the tab loaded; a refusal because the file moved on calls
 *  `onStale(true)` (the pane shows StaleNotice), any other failure is a toast. */
/** T-073: the disk stamp of one file, null when it is gone or the check failed. */
export const stampOne = (path: string): Promise<Stamp | null> =>
  invoke<(Stamp | null)[]>("file_stamps", { paths: [path] }).then(
    (r) => r?.[0] ?? null,
    () => null,
  );

/** Writes the buffer and remembers the stamp the write answered with, so Kolux's own save never
 *  looks like someone else's change (EDIT-003). */
async function writeRemembering(path: string, force: boolean): Promise<void> {
  let wrote: Stamp | null | undefined;
  // T-073-e (council A1): while the write is out the disk check treats this file as unchanged, so
  // a poll landing between the write and remember() cannot flash the banner on the user's own save.
  beginSave(path);
  try {
    await save(path, async (text, loadedHash) => void (wrote = await invoke<Stamp | null>("file_write", force ? { path, text } : { path, text, loadedHash })), force);
    remember(path, wrote ?? (await stampOne(path)));
  } finally {
    endSave(path);
  }
}

export async function saveFile(path: string, onStale: (stale: boolean) => void, onToast?: (text: string) => void): Promise<void> {
  try {
    await writeRemembering(path, false);
    onStale(false);
  } catch (err) {
    if (isStale(err)) return onStale(true);
    onToast?.(`${baseName(path)} was not saved: ${String(err)}`);
  }
}

/** The choice after a stale refusal: Reload takes the disk copy, Keep mine writes over it. */
export function StaleNotice({ path, onDone, onToast }: { path: string; onDone: () => void; onToast?: (text: string) => void }) {
  const name = baseName(path);
  return (
    <div className="notice save-stale" role="alert">
      {name} changed on disk since you opened it, so it was not saved.
      <button
        className="btn"
        title="Show the disk copy; your unsaved edits are dropped"
        onClick={() =>
          void readFresh(
            path,
            () => stampOne(path),
            () => invoke<string>("file_read", { path }),
          ).then(
            (got) => {
              if (!got) return;
              replaceAll(path, got.text, true);
              remember(path, got.stamp);
              onDone();
            },
            (err) => onToast?.(name + " did not reload: " + String(err)),
          )
        }
      >
        Reload
      </button>
      <button
        className="btn"
        title="Save your text over the disk copy"
        onClick={() =>
          void writeRemembering(path, true).then(
            () => onDone(),
            (err) => onToast?.(name + " was not saved: " + String(err)),
          )
        }
      >
        Keep mine
      </button>
    </div>
  );
}

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
type Props = { id: number; path: string; root?: string | null; readOnly?: boolean; hidden?: boolean; focused?: boolean; onFocus?: () => void; onClose?: () => void; onDirty?: (dirty: boolean) => void; onToast?: (text: string) => void; autosave?: number | null; start?: Start; movedFrom?: string };

export default function EditorPane({ id, path, root = null, readOnly = false, hidden = false, focused = false, onFocus, onClose, onDirty, onToast, autosave = null, start, movedFrom }: Props) {
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
  const [stale, setStale] = useState(false); // the last save was refused: the disk copy moved on
  // T-073: the disk copy changed under unsaved edits (with the stamp Keep my edits keeps), the
  // Compare view, and the Undo toast after a Reload.
  const [moved, setMoved] = useState<{ stamp: Stamp | null } | null>(null);
  const [comparing, setComparing] = useState(false);
  const [undoable, setUndoable] = useState<UndoEntry | null>(null);
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
    setMoved(null);
    setComparing(false);
    let loaded: Stamp | null = null;
    // T-073: the stamp is taken before the text, so a write landing in between shows at the next check.
    stampOne(path)
      .then((st) => ((loaded = st), loadText(() => invoke<string>("file_read", { path }))))
      .then(
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
          extensions: [EditorState.lineSeparator.of(text.includes("\r\n") ? "\r\n" : "\n"), EditorState.readOnly.of(readOnly), basicSetup, look, syntaxHighlighting(oneDarkHighlightStyle), lang.of([]), EditorView.updateListener.of((u) => {
              u.transactions.forEach((tr) => relay(path, u.view, tr));
              looks.set(id, { caret: u.state.selection.main.head, mode: modeNow.current });
            }), EditorView.updateListener.of((u) => (u.selectionSet || u.docChanged || u.focusChanged || u.geometryChanged) && place.current(u.view)), EditorView.domEventHandlers({ scroll: (_e, v) => void place.current(v) }),
          ],
        });
        view.current = made;
        attach(path, made, text);
        looks.set(id, { caret: made.state.selection.main.head, mode: modeNow.current });
        // EDIT-003 after a restart: a draft whose file moved on meanwhile gets the banner.
        if (begin?.draft !== undefined && begin.base !== undefined && begin.base !== hashText(text) && isDirty(path)) {
          stopAutosave(path);
          setMoved({ stamp: null });
        }
        // A twin pane already holds this file: its stamp stays the one its copy came from.
        if (textOf(path) === text) remember(path, loaded);
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
    editors.set(id, () => saveFile(path, (s) => (setStale(s), s || resumeAutosave(path)), report.current.onToast));
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
      if (textOf(path) === null) forget(path);
      view.current = null;
    };
  }, [id, path, tries]);

  useEffect(() => {
    const l = looks.get(id);
    if (l) l.mode = mode;
  }, [id, mode]);

  // EDIT-003 (T-073): the disk check, only while this tab is in front: at once when it comes
  // forward (a background tab whose file changed reloads then, not while hidden), every POLL_MS
  // and whenever the window gets focus.
  const io = useRef<Io>(null!);
  io.current = {
    stamp: () => stampOne(path),
    read: () => invoke<string>("file_read", { path }),
    dirty: () => isDirty(path),
    current: () => textOf(path),
    apply: (text, undoable) => replaceAll(path, text, undoable),
  };
  useEffect(() => {
    if (hidden || !ready || readOnly) return;
    let busy = false;
    let alive = true;
    const raised = (stamp: Stamp | null) => alive && setMoved((m) => (m && m.stamp?.mtime === stamp?.mtime && m.stamp?.size === stamp?.size ? m : { stamp }));
    const check = () => {
      if (busy) return;
      busy = true;
      void checkOnce(path, io.current, raised)
        .then(
          (v) => alive && v !== "banner" && setMoved(null),
          () => undefined,
        )
        .finally(() => (busy = false));
    };
    check();
    // ponytail: each poll's file_stamps runs fence.allow, which lists worktrees about every 4 s
    // (TREES_FRESH 3 s) under the fence mutex while an agent-worktree file is open (council MERGE 33
    // A3, folded into the MERGE 29 A1 fence fast path by origin record); the upgrade is that fast
    // path, or a fence decision cached per open tab, not a slower poll.
    const timer = window.setInterval(check, POLL_MS);
    window.addEventListener("focus", check);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [path, hidden, ready, readOnly]);
  useEffect(() => {
    if (!undoable) return;
    const t = window.setTimeout(() => setUndoable(null), UNDO_TOAST_MS);
    return () => window.clearTimeout(t);
  }, [undoable]);
  useEffect(() => markBanner(path, !!moved), [path, moved]);
  const reload = () =>
    void reloadNow(path, io.current).then(
      (u) => {
        if (!u) return;
        setMoved(null);
        setComparing(false);
        setUndoable(u);
      },
      (err) => report.current.onToast?.(`${baseName(path)} did not reload: ${String(err)}`),
    );
  const keepMine = () => {
    keep(path, moved?.stamp ?? null);
    setMoved(null);
    setComparing(false);
  };
  const undoReload = () => {
    const cm = view.current;
    if (cm && canUndo(undoable, textOf(path))) undo(cm);
    else report.current.onToast?.("The reload can no longer be undone from the toast; Ctrl+Z in the tab still steps back through it.");
    setUndoable(null);
  };
  const readDisk = useCallback(() => invoke<string>("file_read", { path }), [path]);

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
  }, [path]);

  // EDIT-002: autosave, when it is switched on, while the file is open in this tab.
  useEffect(() => {
    if (!ready || autosave === null) return;
    return watchAutosave(
      path,
      autosave,
      (text) => invoke("file_write", { path, text }),
      () => invoke<string>("file_read", { path }),
      () => setMoved({ stamp: null }),
      (err) => report.current.onToast?.(`${baseName(path)} was not saved: ${String(err)}`),
    );
  }, [ready, autosave, path]);

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
      {stale && <StaleNotice path={path} onDone={() => setStale(false)} onToast={report.current.onToast} />}
      {moved && !stale && !comparing && <DiskBanner path={path} onReload={reload} onKeep={keepMine} onCompare={() => setComparing(true)} />}
      {undoable && !moved && <UndoToast path={path} onUndo={undoReload} onClose={() => setUndoable(null)} />}
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
      {comparing && <CompareView path={path} text={textOf(path) ?? ""} read={readDisk} onReload={reload} onKeep={keepMine} onClose={() => setComparing(false)} />}
      <div ref={host} className="pane-body" hidden={shown !== "source" || comparing} />
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
      {md && <div ref={richHost} className="pane-body md-rich" contentEditable suppressContentEditableWarning spellCheck hidden={shown !== "rich" || comparing} aria-label={`${name}, rich view`} />}
    </section>
  );
}
