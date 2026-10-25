// GIT-040 (T-034-b): notes on the old (left) side of a side-by-side diff. The old side is the file
// before the change, so a note there holds line numbers of that text, not of the working file.
import type { Text } from "@codemirror/state";
import type { LineNote, Side } from "./diffNotes";

/** The lines a note on the old side may cover, cut to the text it has; null when the old side is
 * empty (an added file), which has no line to hang a note on. */
export function oldSideDoc(doc: Text, line: number, end: number): { line: number; end: number } | null {
  if (doc.length === 0) return null;
  const last = (n: number) => Math.min(Math.max(n, 1), doc.lines);
  const from = last(line);
  return { line: from, end: Math.max(from, last(end)) };
}

/** A new note carries its side only when it is the old one (the new side is the default). */
export const withOldSideNote = (note: LineNote, side: Side): LineNote => (side === "old" ? { ...note, side: "old" } : note);

type Span = { fromA: number; toA: number; fromB: number; toB: number };

/** Row 25: where the card of an old-side note hangs in a unified diff, which shows the old text only as
 *  deleted lines above the new ones. A line in a changed chunk hangs under that chunk's deleted lines
 *  (side just under 0, after the merge view's own widget at -1); an unchanged line hangs under the line
 *  it is now (side 2, after a new-side card there). Null when the old side is empty. */
export function unifiedSpot(chunks: readonly Span[], orig: Text, doc: Text, line: number): { pos: number; side: number } | null {
  if (orig.length === 0) return null;
  const p = orig.line(Math.min(Math.max(line, 1), orig.lines)).from;
  const hit = chunks.find((c) => c.toA > c.fromA && p >= c.fromA && p < c.toA);
  if (hit) return { pos: Math.min(hit.fromB, doc.length), side: -0.5 };
  const done = chunks.filter((c) => c.toA <= p);
  const before = done[done.length - 1];
  const at = Math.min(before ? p - before.toA + before.toB : p, doc.length);
  return { pos: doc.lineAt(at).to, side: 2 };
}
