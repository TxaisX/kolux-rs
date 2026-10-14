// A diff tab (EDIT-027): one file's staged or unstaged change, inline or in two columns. It starts
// inline, with whitespace-only changes hidden and long lines unwrapped; the actions menu turns
// either on. F7 and Shift+F7 (App's shortcut router, `diffNav`) step through the changes. An
// unstaged diff's right side is the working file itself, kept in the shared buffer (buffers.ts), so
// it can be edited and Mod+S writes the file. The sides are read again whenever git state moves
// (the git status watcher, scm/watch.ts) while the tab is in front, or when it comes to the front
// after a move, so a change made in a terminal, or a stage made elsewhere, shows without
// reopening. A markdown file's diff is source text, never the rich view. GIT-040: a review note
// hangs under a line of the new side, in both layouts; the plus in the note gutter or Mod+Shift+A
// on a selection opens the note popover.
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { basicSetup } from "codemirror";
import { Decoration, EditorView, GutterMarker, WidgetType, gutter, keymap, type DecorationSet } from "@codemirror/view";
import { ChangeSet, Compartment, EditorState, Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import { LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { diff, getChunks, getOriginalDoc, goToNextChunk, goToPreviousChunk, MergeView, originalDocChangeEffect, unifiedMergeView } from "@codemirror/merge";
import { ChevronDown, Close, Dots, FileCode, TRASH_PATH } from "../chrome/icons";
import { attach, baseName, detach, isDirty, relay, replaceAll, subscribe, textOf } from "./buffers";
import { editors, look, saveFile, StaleNotice } from "./EditorPane";
import { editedText, type LineNote } from "./diffNotes";
import { watchStatus } from "../scm/watch";
import { watchAutosave } from "./autosave";

/** Next (1) or previous (-1) change, by pane key; App's F7 and Shift+F7 call the focused one. */
export const diffNav = new Map<number, (dir: 1 | -1) => void>();

type Sides = { original: string; modified: string };

const squash = (s: string) => s.replace(/\s+/g, "");
/** The diff with whitespace-only changes left out, which is how a diff tab starts. */
export const withoutWhitespace = (a: string, b: string) => diff(a, b).filter((c) => squash(a.slice(c.fromA, c.toA)) !== squash(b.slice(c.fromB, c.toB)));

// GIT-040: the note cards are block widgets under their line, so their height is part of the
// document's layout and the lines below never jump when a card draws.
type NoteActions = { add: (line: number, end: number, at: { x: number; y: number }) => void; edit: (n: LineNote, at: { x: number; y: number }) => void; remove: (n: LineNote) => void };
const setNotes = StateEffect.define<LineNote[]>();
const noteSpan = (n: LineNote) => (n.end && n.end !== n.line ? `lines ${n.line}-${n.end}` : `line ${n.line}`);
class NoteCard extends WidgetType {
  constructor(
    readonly note: LineNote,
    readonly act: NoteActions,
  ) {
    super();
  }
  eq(o: NoteCard) {
    return o.note.id === this.note.id && o.note.text === this.note.text && o.note.sent === this.note.sent && o.note.line === this.note.line;
  }
  get estimatedHeight() {
    return 56;
  }
  ignoreEvent() {
    return true;
  }
  toDOM() {
    const el = (tag: string, cls: string, text?: string) => Object.assign(document.createElement(tag), { className: cls, ...(text === undefined ? {} : { textContent: text }) });
    const card = el("div", "diff-note");
    card.dataset.note = this.note.id;
    const head = el("div", "diff-note-head");
    head.append(el("span", "what", `Note on ${noteSpan(this.note)}${this.note.sent ? " · sent" : ""}`));
    const edit = el("button", "ib diff-note-edit", "Edit") as HTMLButtonElement;
    edit.title = "Edit this note";
    edit.onclick = (e) => this.act.edit(this.note, { x: e.clientX, y: e.clientY });
    const del = el("button", "ib diff-note-del") as HTMLButtonElement;
    del.title = "Delete this note";
    del.setAttribute("aria-label", "Delete note");
    del.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${TRASH_PATH}"/></svg>`;
    del.onclick = () => this.act.remove(this.note);
    head.append(edit, del);
    card.append(head, el("div", "diff-note-text", this.note.text));
    return card;
  }
}
const noteField = (act: NoteActions) =>
  // A note belongs to a line number, so the cards are laid out again from the notes whenever the
  // text changes (a new read of the file replaces it whole).
  StateField.define<{ notes: LineNote[]; deco: DecorationSet }>({
    create: () => ({ notes: [], deco: Decoration.none }),
    update(was, tr) {
      const set = tr.effects.find((e) => e.is(setNotes));
      if (!set && !tr.docChanged) return was;
      const notes = set ? (set.value as LineNote[]) : was.notes;
      const doc = tr.state.doc;
      const at = (n: LineNote) => Math.min(n.end ?? n.line, doc.lines);
      const ranges = notes.filter((n) => n.line >= 1 && n.line <= doc.lines).map((n) => Decoration.widget({ widget: new NoteCard(n, act), block: true, side: 1 }).range(doc.line(at(n)).to));
      return { notes, deco: Decoration.set(ranges, true) };
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  });
class Plus extends GutterMarker {
  toDOM() {
    return Object.assign(document.createElement("span"), { className: "note-plus", textContent: "+", title: "Add a review note on this line" });
  }
}
const plus = new Plus();
/** The note gutter, the shortcut and the cards, for the new side of a diff. */
const noteTools = (act: NoteActions): Extension => [
  noteField(act),
  gutter({
    class: "cm-note-gutter",
    lineMarker: () => plus,
    initialSpacer: () => plus,
    domEventHandlers: {
      mousedown: (view, line, ev) => {
        const n = view.state.doc.lineAt(line.from).number;
        act.add(n, n, { x: (ev as MouseEvent).clientX, y: (ev as MouseEvent).clientY });
        return true;
      },
    },
  }),
  Prec.highest(
    keymap.of([
      {
        key: "Mod-Shift-a",
        run: (view) => {
          const sel = view.state.selection.main;
          const doc = view.state.doc;
          const end = doc.lineAt(sel.to).number;
          const c = view.coordsAtPos(doc.line(end).to);
          act.add(doc.lineAt(sel.from).number, end, { x: c?.left ?? 200, y: c?.bottom ?? 200 });
          return true;
        },
      },
    ]),
  ),
];
type Pop = { line: number; end: number; note?: LineNote; text: string; x: number; y: number; refused?: boolean };

type Props = { id: number; path: string; staged: boolean; hidden?: boolean; focused?: boolean; onFocus?: () => void; onClose?: () => void; onDirty?: (dirty: boolean) => void; onToast?: (text: string) => void; notes?: LineNote[]; onSaveNote?: (n: LineNote) => void; onDeleteNote?: (n: LineNote) => void; jump?: { line: number; at: number }; autosave?: number | null };

// EDIT-028: past this many lines (both sides together), or this much text, the tab asks before it draws.
const BIG_LINES = 20_000;
const BIG_CHARS = 2_000_000;
/** The line count of a diff too large to draw without asking, or 0 when it can draw straight away. */
export const bigDiff = (s: Sides) => {
  let n = 0;
  for (const t of [s.original, s.modified]) {
    if (!t) continue;
    n++;
    for (let i = t.indexOf("\n"); i !== -1; i = t.indexOf("\n", i + 1)) n++;
  }
  return n > BIG_LINES || s.original.length + s.modified.length > BIG_CHARS ? n : 0;
};

export default function DiffPane({ id, path, staged, hidden = false, focused = false, onFocus, onClose, onDirty, onToast, notes = [], onSaveNote, onDeleteNote, jump, autosave = null }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [sides, setSides] = useState<Sides | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [split, setSplit] = useState(false);
  const [spaces, setSpaces] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [menu, setMenu] = useState(false);
  const [changes, setChanges] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [stale, setStale] = useState(false); // EDIT-003 (T-073-c): the last save was refused, the file moved on
  const views = useRef<{ a: EditorView | null; b: EditorView } | null>(null);
  const shown = useRef<Sides | null>(null); // the sides the views were last given
  const report = useRef({ onDirty, onToast });
  report.current = { onDirty, onToast };
  const front = useRef(!hidden);
  front.current = !hidden;
  const lang = useRef(new Compartment());
  const big = useMemo(() => (sides ? bigDiff(sides) : 0), [sides]);
  const here = `${staged}:${path}`;
  const [loadFor, setLoadFor] = useState<string | null>(null); // the diff the user said to load anyway
  const ready = sides !== null && (!big || loadFor === here);
  const [pop, setPop] = useState<Pop | null>(null);
  const noteRef = useRef({ notes, onDeleteNote, canNote: !!onSaveNote });
  noteRef.current = { notes, onDeleteNote, canNote: !!onSaveNote };
  const act = useRef<NoteActions>({
    add: (line, end, at) => noteRef.current.canNote && setPop({ line, end, text: "", ...at }),
    edit: (note, at) => setPop({ line: note.line, end: note.end ?? note.line, note, text: note.text, ...at }),
    remove: (note) => noteRef.current.onDeleteNote?.(note),
  });
  const notesKey = JSON.stringify(notes);

  // The sides, now and whenever git state moves; a move while the tab is hidden is read on its return.
  const missed = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!hidden && missed.current) {
      const f = missed.current;
      missed.current = null;
      f();
    }
  }, [hidden]);
  useEffect(() => {
    let alive = true;
    setError(null);
    const fetch = () =>
      invoke<Sides>("diff_sides", { path, staged }).then(
        (s) => alive && setSides((old) => (old && old.original === s.original && old.modified === s.modified ? old : s)),
        (err) => alive && setError(String(err)),
      );
    void fetch();
    const stop = watchStatus(path, () => {
      if (front.current) void fetch();
      else missed.current = () => void fetch();
    });
    return () => {
      alive = false;
      missed.current = null;
      stop();
    };
  }, [path, staged, tries]);

  // The views, built again when the layout or a menu option changes.
  useEffect(() => {
    if (!ready || !host.current) return;
    const s = shown.current ?? sides!;
    const modified = (!staged && textOf(path)) || s.modified;
    shown.current = { original: s.original, modified: s.modified };
    const common: Extension[] = [basicSetup, look, syntaxHighlighting(oneDarkHighlightStyle), lang.current.of([]), wrap ? EditorView.lineWrapping : []];
    const count = (st: EditorState) => setChanges(getChunks(st)?.chunks.length ?? 0);
    const right: Extension[] = [
      ...common,
      EditorState.lineSeparator.of(modified.includes("\r\n") ? "\r\n" : "\n"),
      staged ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
      noteTools(act.current),
      EditorView.updateListener.of((u) => {
        count(u.state);
        if (!staged) u.transactions.forEach((tr) => relay(path, u.view, tr));
      }),
    ];
    const diffConfig = spaces ? undefined : { override: withoutWhitespace };
    let a: EditorView | null = null;
    let b: EditorView;
    let merge: MergeView | null = null;
    if (split) {
      merge = new MergeView({ a: { doc: s.original, extensions: [...common, EditorState.readOnly.of(true), EditorView.editable.of(false)] }, b: { doc: modified, extensions: right }, parent: host.current, gutter: true, diffConfig });
      a = merge.a;
      b = merge.b;
    } else {
      b = new EditorView({ doc: modified, parent: host.current, extensions: [...right, unifiedMergeView({ original: s.original, mergeControls: false, gutter: true, diffConfig })] });
    }
    views.current = { a, b };
    b.dispatch({ effects: setNotes.of(noteRef.current.notes) });
    count(b.state);
    if (!staged) attach(path, b, s.modified);
    LanguageDescription.matchFilename(languages, baseName(path))
      ?.load()
      .then((support) => [a, b].forEach((v) => v?.dispatch({ effects: lang.current.reconfigure(support) })))
      .catch(() => undefined);
    return () => {
      if (!staged) detach(path, b);
      views.current = null;
      if (merge) merge.destroy();
      else b.destroy();
    };
  }, [ready, split, spaces, wrap, path, staged]);

  // New sides from git: the left side always follows; the right one does unless it has unsaved edits.
  useEffect(() => {
    const v = views.current;
    const old = shown.current;
    if (!v || !old || !sides) return;
    shown.current = sides;
    if (sides.original !== old.original) {
      const len = (v.a ?? v.b).state.doc.length;
      if (v.a) v.a.dispatch({ changes: { from: 0, to: len, insert: sides.original } });
      else {
        const was = getOriginalDoc(v.b.state);
        v.b.dispatch({ effects: originalDocChangeEffect(v.b.state, ChangeSet.of({ from: 0, to: was.length, insert: sides.original }, was.length)) });
      }
    }
    if (sides.modified !== old.modified) {
      if (!staged) {
        if (!isDirty(path)) replaceAll(path, sides.modified);
      } else v.b.dispatch({ changes: { from: 0, to: v.b.state.doc.length, insert: sides.modified } });
    }
  }, [sides, path, staged]);

  // Unsaved marker and Mod+S, for an unstaged diff. The save carries the loaded hash like an editor
  // tab's (EDIT-003, T-073-c), so an agent's edit made behind the diff is never overwritten unseen.
  useEffect(() => {
    if (staged) return;
    const off = subscribe(path, () => {
      const d = isDirty(path);
      setDirty(d);
      report.current.onDirty?.(d);
    });
    setStale(false);
    editors.set(id, () => saveFile(path, setStale, report.current.onToast));
    return () => {
      off();
      editors.delete(id);
    };
  }, [id, path, staged]);

  // EDIT-002: an unstaged diff's right side is the working file, so autosave covers it; a staged
  // diff is read-only and never autosaves.
  useEffect(() => {
    if (staged || !ready || autosave === null) return;
    return watchAutosave(
      path,
      autosave,
      (text) => invoke("file_write", { path, text }),
      () => invoke<string>("file_read", { path }),
      () => report.current.onToast?.(`${baseName(path)} changed on disk, so autosave left it alone. Save to keep your edits.`),
      (err) => report.current.onToast?.(`${baseName(path)} was not saved: ${String(err)}`),
    );
  }, [staged, ready, autosave, path]);

  // GIT-040 / GIT-041: the cards follow the notes; opening a note from Source Control scrolls to it.
  useEffect(() => views.current?.b.dispatch({ effects: setNotes.of(noteRef.current.notes) }), [notesKey]);
  useEffect(() => {
    const b = views.current?.b;
    if (!b || !jump) return;
    const at = b.state.doc.line(Math.min(Math.max(jump.line, 1), b.state.doc.lines)).from;
    b.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: "center" }) });
  }, [jump?.at, ready, split]);
  const savePop = () => {
    if (!pop) return;
    const text = editedText(pop.text);
    if (text === null) return setPop({ ...pop, refused: true });
    onSaveNote?.(pop.note ? { ...pop.note, text, sent: undefined } : { id: crypto.randomUUID(), path, line: pop.line, ...(pop.end !== pop.line ? { end: pop.end } : {}), text, staged });
    setPop(null);
  };

  useEffect(() => {
    diffNav.set(id, (dir) => {
      const b = views.current?.b;
      if (!b) return;
      (dir > 0 ? goToNextChunk : goToPreviousChunk)(b);
      b.focus();
    });
    return () => void diffNav.delete(id);
  }, [id]);

  useEffect(() => {
    if (focused && !hidden) views.current?.b.focus();
  }, [focused, hidden, ready]);

  const name = baseName(path);
  const step = (dir: 1 | -1) => diffNav.get(id)?.(dir);
  return (
    <section className={`pane editor diff${focused ? " focused" : ""}`} hidden={hidden} aria-label={`Diff of ${name}`} onMouseDown={onFocus} data-kind="diff" data-key={id}>
      <header className="pane-head">
        <span className="agent-mark" title="Diff">
          <FileCode size={13} />
        </span>
        <span className="title">{name}</span>
        <span className="preview-tag">{staged ? "Staged" : "Unstaged"}</span>
        {dirty && <span className="unsaved" title="Unsaved changes" aria-label="Unsaved changes" />}
        <span className="path" title={path}>
          {path}
        </span>
        <span className="view-switch" role="group" aria-label="Layout">
          <button aria-pressed={!split} onClick={() => setSplit(false)} title="Inline">
            Inline
          </button>
          <button aria-pressed={split} onClick={() => setSplit(true)} title="Side by side">
            Side by side
          </button>
        </span>
        <span className="right">
          <button className="ib" disabled={!changes} onClick={() => step(-1)} title="Previous change (Shift+F7)" aria-label="Previous change">
            <ChevronDown size={12} style={{ transform: "rotate(180deg)" }} />
          </button>
          <button className="ib" disabled={!changes} onClick={() => step(1)} title="Next change (F7)" aria-label="Next change">
            <ChevronDown size={12} />
          </button>
          <span className="diff-actions">
            <button className="ib" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)} title="Diff actions" aria-label="Diff actions">
              <Dots size={12} />
            </button>
            {menu && (
              <>
                <div className="menu-backdrop" onMouseDown={() => setMenu(false)} />
                <div className="menu diff-menu" role="menu">
                  <button role="menuitemcheckbox" aria-checked={spaces} className="menu-item" onClick={() => setSpaces((v) => !v)}>
                    <span className="check">{spaces ? "✓" : ""}</span>
                    <span className="name">Show whitespace changes</span>
                  </button>
                  <button role="menuitemcheckbox" aria-checked={wrap} className="menu-item" onClick={() => setWrap((v) => !v)}>
                    <span className="check">{wrap ? "✓" : ""}</span>
                    <span className="name">Wrap lines</span>
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
          The diff of {name} did not load: {error}
          <button className="btn" onClick={() => setTries((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}
      {sides && !ready && (
        <div className="notice md-banner" role="status">
          This diff is large ({big.toLocaleString()} lines across both sides) and may take a while to draw.
          <button className="btn" onClick={() => setLoadFor(here)}>
            Load diff
          </button>
        </div>
      )}
      {stale && !staged && <StaleNotice path={path} onDone={() => setStale(false)} onToast={report.current.onToast} />}
      {ready && !changes && <div className="notice md-banner" role="status">No {staged ? "staged" : "unstaged"} changes in this file right now.</div>}
      <div ref={host} className="pane-body diff-body" />
      {pop && (
        <>
          <div className="menu-backdrop" onMouseDown={() => setPop(null)} />
          <div className="diff-note-pop" role="dialog" aria-label={pop.note ? "Edit review note" : "Add review note"} style={{ left: Math.max(8, Math.min(pop.x, window.innerWidth - 336)), top: Math.max(8, Math.min(pop.y + 12, window.innerHeight - 190)) }}>
            <div className="what">{`${pop.note ? "Edit the note on" : "Note on"} ${pop.end !== pop.line ? `lines ${pop.line}-${pop.end}` : `line ${pop.line}`}`}</div>
            <textarea
              autoFocus
              aria-label="review note"
              className="field multi"
              value={pop.text}
              placeholder="What should change here?"
              onChange={(e) => setPop({ ...pop, text: e.target.value, refused: false })}
              onKeyDown={(e) => {
                if (e.key === "Escape") setPop(null);
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) savePop();
              }}
            />
            {pop.refused && <div className="note error">A note needs some text. To remove it, use the bin on its card.</div>}
            <div className="btn-row">
              <button className="btn primary" onClick={savePop} disabled={!pop.note && !pop.text.trim()}>
                {pop.note ? "Save" : "Add note"}
              </button>
              <button className="btn" onClick={() => setPop(null)}>
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
