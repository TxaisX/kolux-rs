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
