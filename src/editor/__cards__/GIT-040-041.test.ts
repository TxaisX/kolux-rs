// GIT-040 box 1 and GIT-041 boxes 1-2 with the REAL note field (CodeMirror state) and the REAL note functions.
// MIRROR src/editor/DiffPane.tsx:310 (inline and split share the same right-hand extensions, noteTools(act, "new") -> noteField);
// MIRROR src/App.tsx:2390-2399 sendNotes(): pastes noteBlocks(notes, dir), then saveNotes(markSent(current, sent)).
import { EditorState } from "@codemirror/state";
import { expect, test } from "vitest";
import { noteField, setNotes, type NoteActions } from "../DiffPane";
import { clearDelivered, markSent, noteBlocks, type LineNote } from "../diffNotes";

const act: NoteActions = { add: () => {}, edit: () => {}, remove: () => {} };
const n = (id: string, path: string, line: number, text: string): LineNote => ({ id, path, line, text, staged: false });
const doc = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");

// every card as [position it is drawn at, the line that position belongs to, which way it sits]
const cards = (notes: LineNote[]) => {
  const field = noteField(act, "new");
  const state = EditorState.create({ doc, extensions: [field] }).update({ effects: setNotes.of(notes) }).state;
  const out: { line: number; side: number; block: boolean; text: string }[] = [];
  state.field(field).deco.between(0, state.doc.length, (from, _to, v) => void out.push({ line: state.doc.lineAt(from).number, side: v.spec.side, block: v.spec.block, text: v.spec.widget.note.text }));
  return out;
};

test("GIT-040 box 1: a note on line 12 is a block card under line 12, in the inline and the side-by-side layout alike", () => {
  const notes = [n("a", "a.ts", 12, "check this")];
  const inline = cards(notes);
  const split = cards(notes); // the split layout's right-hand view is built from the same extensions
  expect(inline).toEqual([{ line: 12, side: 1, block: true, text: "check this" }]);
  expect(split).toEqual(inline);
  // the card ends line 12 (after its last character), never the start of 13
  const field = noteField(act, "new");
  const st = EditorState.create({ doc, extensions: [field] }).update({ effects: setNotes.of(notes) }).state;
  let at = -1;
  st.field(field).deco.between(0, st.doc.length, (from) => void (at = from));
  expect(at).toBe(st.doc.line(12).to);
});

test("GIT-041 box 1: three notes over two files go out as one message holding all three, and all three then show as sent", () => {
  const root = "G:/w/repo";
  const notes = [n("1", "G:/w/repo/src/a.ts", 3, "first"), n("2", "G:/w/repo/src/a.ts", 12, "second"), n("3", "G:/w/repo/src/b.ts", 7, "third")];
  const message = noteBlocks(notes, root);
  expect(message).toBe("src/a.ts, line 3\nfirst\n\nsrc/a.ts, line 12\nsecond\n\nsrc/b.ts, line 7\nthird");
  const after = markSent(notes, notes);
  expect(after.map((x) => x.sent)).toEqual([true, true, true]);
  expect(clearDelivered(after)).toEqual([]);
});

test("GIT-041 box 2: a note edited while the send runs is not marked sent, and clearing delivered notes leaves it", () => {
  const before = [n("1", "a.ts", 1, "one"), n("2", "a.ts", 2, "two"), n("3", "b.ts", 1, "three")];
  const sending = before; // what sendNotes() pasted
  const now = before.map((x) => (x.id === "2" ? { ...x, text: "two, edited" } : x)); // the user edits during the send
  const marked = markSent(now, sending);
  expect(marked.find((x) => x.id === "2")!.sent).toBeUndefined();
  expect(clearDelivered(marked)).toEqual([{ ...now[1] }]);
});
