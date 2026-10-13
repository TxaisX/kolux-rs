import { expect, test } from "vitest";
import { clearDelivered, editedText, lineNotesOf, markSent, noteBlocks, notesByFile, withLineNotes, type LineNote } from "./diffNotes";

const n = (id: string, path: string, line: number, text: string, sent?: boolean): LineNote => ({ id, path, line, text, staged: false, sent });

test("GIT-040: an edit is trimmed and an empty one is refused", () => {
  expect(editedText("  keep this  \n")).toBe("keep this");
  expect(editedText("   \n  ")).toBeNull();
});

test("GIT-041: notes go out as one message of short blocks, by file then line, a blank line between", () => {
  const root = "G:/w/repo";
  const notes = [n("1", "G:/w/repo/src/b.ts", 9, "second file"), n("2", "G:/w/repo/src/a.ts", 12, "later line"), n("3", "G:/w/repo/src/a.ts", 3, "first line\ntwo lines")];
  expect(noteBlocks(notes, root)).toBe("src/a.ts, line 3\nfirst line\ntwo lines\n\nsrc/a.ts, line 12\nlater line\n\nsrc/b.ts, line 9\nsecond file");
  expect(notesByFile(notes).map(([p, ns]) => [p, ns.map((x) => x.line)])).toEqual([
    ["G:/w/repo/src/a.ts", [3, 12]],
    ["G:/w/repo/src/b.ts", [9]],
  ]);
  // a Windows path with backslashes still loses the workspace part
  expect(noteBlocks([n("4", "G:\\w\\repo\\x.ts", 1, "hi")], "G:\\w\\repo")).toBe("x.ts, line 1\nhi");
});

test("GIT-041: clearing delivered notes keeps a note edited while the send was in flight", () => {
  const before = [n("1", "a.ts", 1, "one"), n("2", "a.ts", 2, "two"), n("3", "b.ts", 1, "three")];
  const sending = before;
  const meanwhile = before.map((x) => (x.id === "2" ? { ...x, text: "two, edited" } : x));
  const marked = markSent(meanwhile, sending);
  expect(marked.map((x) => !!x.sent)).toEqual([true, false, true]);
  expect(clearDelivered(marked).map((x) => x.id)).toEqual(["2"]);
});

test("GIT-041: notes are kept per workspace, a folder without Git as well", () => {
  const book = withLineNotes({}, "G:\\w\\folder", [n("1", "G:/w/folder/x.txt", 1, "hi")]);
  expect(lineNotesOf(book, "g:/w/folder").map((x) => x.id)).toEqual(["1"]);
  expect(lineNotesOf(book, "G:/w/other")).toEqual([]);
  expect(lineNotesOf("junk", "G:/w/folder")).toEqual([]);
  expect(withLineNotes(book, "G:/w/folder", [])).toEqual({});
});
