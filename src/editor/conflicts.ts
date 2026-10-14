// EDIT-009: merge conflicts left in a file after a merge or a rebase. Each conflict's sides are
// coloured (ours, the diff3 base when there is one, theirs) and next / previous conflict step
// between them, wrapping at either end. In an editor tab F7 and Shift+F7 (editor.nextChange /
// editor.previousChange, the change-stepping keys) step conflicts when the file has any, and the
// header shows the count with two arrows.
import { RangeSetBuilder, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

/** Line numbers (1-based) of one conflict's markers; `base` is the `|||||||` line or null. */
export type Conflict = { start: number; base: number | null; mid: number; end: number };

const START = /^<{7}(?: |$)/;
const BASE = /^\|{7}(?: |$)/;
const MID = /^={7}$/;
const END = /^>{7}(?: |$)/;

/** Every complete conflict in the file, in order. Half-written or look-alike markers are skipped. */
export function findConflicts(lines: readonly string[]): Conflict[] {
  const out: Conflict[] = [];
  let open: { start: number; base: number | null; mid: number | null } | null = null;
  lines.forEach((raw, i) => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const n = i + 1;
    if (START.test(line)) open = { start: n, base: null, mid: null };
    else if (!open) return;
    else if (BASE.test(line) && open.mid === null && open.base === null) open.base = n;
    else if (MID.test(line) && open.mid === null) open.mid = n;
    else if (END.test(line) && open.mid !== null) {
      out.push({ start: open.start, base: open.base, mid: open.mid, end: n });
      open = null;
    }
  });
  return out;
}

/** The conflict to go to from the caret's line, or null when there are none. Wraps both ways. */
export function stepConflict(list: readonly Conflict[], line: number, dir: 1 | -1): number | null {
  if (!list.length) return null;
  const cur = list.findIndex((c) => c.start <= line && line <= c.end);
  let to: number;
  if (cur >= 0) to = cur + dir;
  else if (dir === 1) to = list.findIndex((c) => c.start > line);
  else to = list.map((c) => c.end < line).lastIndexOf(true);
  if (to < 0 || to >= list.length) to = dir === 1 ? 0 : list.length - 1;
  return to;
}

export function conflictsOf(state: EditorState): Conflict[] {
  const doc = state.doc;
  if (!doc.sliceString(0, doc.length).includes("<<<<<<<")) return [];
  const lines: string[] = [];
  for (let i = 1; i <= doc.lines; i++) lines.push(doc.line(i).text);
  return findConflicts(lines);
}

const marker = Decoration.line({ class: "cm-conflict-marker" });
const ours = Decoration.line({ class: "cm-conflict-ours" });
const base = Decoration.line({ class: "cm-conflict-base" });
const theirs = Decoration.line({ class: "cm-conflict-theirs" });

function decorate(state: EditorState, list: Conflict[]): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const c of list)
    for (let n = c.start; n <= c.end; n++) {
      const kind = n === c.start || n === c.mid || n === c.end || n === c.base ? marker : n < (c.base ?? c.mid) ? ours : n < c.mid ? base : theirs;
      b.add(state.doc.line(n).from, state.doc.line(n).from, kind);
    }
  return b.finish();
}

/** The file's conflicts, kept current as it is edited. */
export const conflictField = StateField.define<{ list: Conflict[]; deco: DecorationSet }>({
  create: (s) => {
    const list = conflictsOf(s);
    return { list, deco: decorate(s, list) };
  },
  update: (v, tr) => {
    if (!tr.docChanged) return v;
    const list = conflictsOf(tr.state);
    return { list, deco: decorate(tr.state, list) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

const look = EditorView.baseTheme({
  ".cm-conflict-ours": { background: "color-mix(in srgb, #3fb950 16%, transparent)" },
  ".cm-conflict-base": { background: "color-mix(in srgb, #8b949e 14%, transparent)" },
  ".cm-conflict-theirs": { background: "color-mix(in srgb, #58a6ff 18%, transparent)" },
  ".cm-conflict-marker": { background: "color-mix(in srgb, #d29922 18%, transparent)", fontWeight: "600" },
});

export const conflictColours: Extension = [conflictField, look];

/** Moves the caret to the next or previous conflict and scrolls it into view; false when none. */
export function goConflict(view: EditorView, dir: 1 | -1 | 0): boolean {
  const list = view.state.field(conflictField, false)?.list ?? [];
  const line = view.state.doc.lineAt(view.state.selection.main.head).number;
  const i = dir === 0 ? (list.length ? 0 : null) : stepConflict(list, line, dir);
  if (i === null) return false;
  const at = view.state.doc.line(list[i].start).from;
  view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: "center" }) });
  return true;
}
