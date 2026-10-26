// GIT-040 / GIT-041 (T-034-b): review notes on the old (left) side of a side-by-side diff.
import { expect, test } from "vitest";
import { Text } from "@codemirror/state";
import { clearDelivered, lineLabel, markSent, noteBlocks, notesByFile, notesOn, sideOf, where, type LineNote } from "./diffNotes";
import { oldSideDoc, withOldSideNote } from "./oldSide";

const n = (id: string, line: number, text: string, extra: Partial<LineNote> = {}): LineNote => ({ id, path: "G:/w/repo/src/a.ts", line, text, staged: false, ...extra });

test("GIT-040: a note belongs to the side it was made on; older notes without a side are on the new side", () => {
  const all = [n("1", 4, "new side"), n("2", 4, "old side", { side: "old" }), n("3", 9, "also new", { side: undefined })];
  expect(all.map(sideOf)).toEqual(["new", "old", "new"]);
  expect(notesOn(all, "new").map((x) => x.id)).toEqual(["1", "3"]);
  expect(notesOn(all, "old").map((x) => x.id)).toEqual(["2"]);
  // the same line number on both sides gives two notes, never one over the other
  expect(notesOn(all, "old")[0].line).toBe(notesOn(all, "new")[0].line);
});

test("GIT-040: the card, the list and the message say when a note is on the old side", () => {
  expect(where(n("1", 12, "x"))).toBe("line 12");
  expect(where(n("1", 12, "x", { end: 14 }))).toBe("lines 12-14");
  expect(where(n("1", 12, "x", { side: "old" }))).toBe("line 12 (old side)");
  expect(where(n("1", 12, "x", { end: 14, side: "old" }))).toBe("lines 12-14 (old side)");
  expect(lineLabel(n("1", 12, "x"))).toBe("12");
  expect(lineLabel(n("1", 12, "x", { end: 14 }))).toBe("12-14");
  expect(lineLabel(n("1", 12, "x", { side: "old" }))).toBe("old 12");
  const root = "G:/w/repo";
  expect(noteBlocks([n("1", 12, "kept line")], root)).toBe("src/a.ts, line 12\nkept line");
  expect(noteBlocks([n("2", 12, "gone line", { side: "old" })], root)).toBe("src/a.ts, line 12 (old side)\ngone line");
  // both sides of one line are both sent, the new side first
  const both = noteBlocks([n("2", 12, "gone line", { side: "old" }), n("1", 12, "kept line")], root).split("\n\n");
  expect(both).toEqual(["src/a.ts, line 12\nkept line", "src/a.ts, line 12 (old side)\ngone line"]);
});

test("GIT-041: old-side notes list with their file, are sent, marked sent and cleared like the rest", () => {
  const notes = [n("1", 2, "new"), n("2", 2, "old", { side: "old" }), n("3", 7, "other", { side: "old" })];
  expect(notesByFile(notes)[0][1].map((x) => x.id)).toEqual(["1", "2", "3"]);
  const edited = notes.map((x) => (x.id === "3" ? { ...x, text: "other, edited" } : x));
  const after = markSent(edited, notes);
  expect(after.find((x) => x.id === "2")).toMatchObject({ sent: true, side: "old" });
  expect(clearDelivered(after).map((x) => x.id)).toEqual(["3"]);
});

test("GIT-040: only a line the old side has can take a note, and a saved note keeps its side when edited", () => {
  const doc = Text.of("one\ntwo\nthree".split("\n"));
  expect(oldSideDoc(doc, 1, 3)).toEqual({ line: 1, end: 3 });
  expect(oldSideDoc(doc, 3, 9)).toEqual({ line: 3, end: 3 }); // cut to the last line
  expect(oldSideDoc(doc, 0, 1)).toEqual({ line: 1, end: 1 });
  expect(oldSideDoc(Text.of([""]), 1, 1)).toBeNull(); // an added file has no old side
  const made = withOldSideNote({ id: "x", path: "p", line: 2, text: "t", staged: false }, "old");
  expect(made.side).toBe("old");
  expect("side" in withOldSideNote({ id: "x", path: "p", line: 2, text: "t", staged: false }, "new")).toBe(false);
  // editing keeps the side
  expect({ ...made, text: "t2", sent: undefined }.side).toBe("old");
});

// Row 25: an old-side note is drawn in the unified layout too, where the old text exists only as the
// deleted chunks above the new lines.
import { Chunk } from "@codemirror/merge";
import { unifiedSpot } from "./oldSide";

test("row 25: an old-side note in a deleted chunk hangs under that chunk's deleted lines, before the new text", () => {
  const a = Text.of(["one", "two", "three", "four", "five"]);
  const b = Text.of(["one", "four", "five"]); // two and three deleted
  const chunks = Chunk.build(a, b);
  const spot = unifiedSpot(chunks, a, b, 3)!;
  expect(spot.pos).toBe(b.line(2).from); // the chunk starts where "four" is
  expect(spot.side).toBeLessThan(0);
  expect(spot.side).toBeGreaterThan(-1); // after the deleted-lines widget (side -1)
  expect(unifiedSpot(chunks, a, b, 2)).toEqual(spot);
});

test("row 25: an old-side note on an unchanged line follows the line to where it is now, after a new-side card there", () => {
  const a = Text.of(["one", "two", "three", "four", "five"]);
  const b = Text.of(["one", "four", "five"]);
  const chunks = Chunk.build(a, b);
  const spot = unifiedSpot(chunks, a, b, 5)!; // "five" is line 3 now
  expect(spot.pos).toBe(b.line(3).to);
  expect(spot.side).toBeGreaterThan(1); // new-side cards use side 1
  expect(unifiedSpot(chunks, a, b, 1)!.pos).toBe(b.line(1).to); // before any change
  // lines added above push an old line down
  const c = Text.of(["new", "new2", "one", "two"]);
  expect(unifiedSpot(Chunk.build(Text.of(["one", "two"]), c), Text.of(["one", "two"]), c, 2)!.pos).toBe(c.line(4).to);
});

test("row 25: a line past the old text is cut to its last line, and a file with no old side has no spot", () => {
  const a = Text.of(["one", "two"]);
  const b = Text.of(["zero", "one", "two"]);
  expect(unifiedSpot(Chunk.build(a, b), a, b, 9)!.pos).toBe(b.line(3).to);
  expect(unifiedSpot(Chunk.build(Text.of([""]), b), Text.of([""]), b, 1)).toBeNull();
});
