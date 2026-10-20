// GIT-041 (T-034-b): notes in a folder workspace without Git.
import { expect, test } from "vitest";
import { clearDelivered, lineNotesOf, markSent, noteBlocks, notesByFile, withLineNotes } from "./diffNotes";
import { emptyNotesHint, lastLineOf, noteTarget, plainNote, repolessError } from "./fileNotes";

const folder = "G:\\Notes\\Trip plans";
const sel = (line: number, quote: string, note: string) => ({ path: "G:/Notes/Trip plans/day1.txt", line, quote, note });

test("GIT-041: git's refusal for a plain folder is recognised, other failures are not", () => {
  expect(repolessError("fatal: not a git repository (or any of the parent directories): .git")).toBe(true);
  expect(repolessError("G:/Notes/Trip plans is not inside a Git repository")).toBe(true);
  expect(repolessError("could not run git: program not found")).toBe(false);
  expect(repolessError("")).toBe(false);
});

test("GIT-041: a note on a selection in a plain file covers the selected lines and is trimmed", () => {
  expect(lastLineOf(5, "one")).toBe(5);
  expect(lastLineOf(5, "one\ntwo\nthree\n")).toBe(7); // a trailing line end is not a fourth line
  expect(plainNote(sel(5, "one\ntwo\nthree", "  check the date  \n"), "n1")).toEqual({ id: "n1", path: "G:/Notes/Trip plans/day1.txt", line: 5, end: 7, text: "check the date", staged: false });
  expect(plainNote(sel(9, "single", "x"), "n2")).toEqual({ id: "n2", path: "G:/Notes/Trip plans/day1.txt", line: 9, text: "x", staged: false });
  // an empty note is refused, as in a diff
  expect(plainNote(sel(9, "single", "  \n "), "n3")).toBeNull();
});

test("GIT-041: the folder alone keys the notes, so they are kept, listed, sent and cleared without a repository", () => {
  const a = plainNote(sel(12, "later", "second"), "a")!;
  const b = plainNote({ path: "G:/Notes/Trip plans/day1.txt", line: 3, quote: "first\nfirst b", note: "first" }, "b")!;
  const c = plainNote({ path: "G:/Notes/Trip plans/sub/day2.txt", line: 1, quote: "x", note: "other file" }, "c")!;
  const book = withLineNotes({}, folder, [a, b, c]);
  // the same folder spelled another way (slashes, case, trailing slash) finds them; a sibling folder does not
  expect(lineNotesOf(book, "g:/notes/trip plans/").map((n) => n.id)).toEqual(["a", "b", "c"]);
  expect(lineNotesOf(book, "G:/Notes/Trip plans 2")).toEqual([]);
  expect(lineNotesOf(book, "G:/Notes")).toEqual([]);
  // the notes list by file, and the message the agent gets names files relative to the folder
  expect(notesByFile(lineNotesOf(book, folder)).map(([p, ns]) => [p, ns.map((n) => n.line)])).toEqual([
    ["G:/Notes/Trip plans/day1.txt", [3, 12]],
    ["G:/Notes/Trip plans/sub/day2.txt", [1]],
  ]);
  expect(noteBlocks(lineNotesOf(book, folder), folder)).toBe("day1.txt, lines 3-4\nfirst\n\nday1.txt, line 12\nsecond\n\nsub/day2.txt, line 1\nother file");
  // after a send, sent notes clear and one edited in flight stays
  const edited = lineNotesOf(book, folder).map((n) => (n.id === "a" ? { ...n, text: "second, edited" } : n));
  expect(clearDelivered(markSent(edited, lineNotesOf(book, folder))).map((n) => n.id)).toEqual(["a"]);
  expect(withLineNotes(book, folder, [])).toEqual({});
});

test("GIT-041: without Git a note opens the file at its line, and the empty section says how to add one", () => {
  expect(noteTarget(true)).toBe("file");
  expect(noteTarget(false)).toBe("diff");
  expect(emptyNotesHint(true, "Ctrl+Shift+A")).toBe("No review notes yet. In a file, select some lines and press Ctrl+Shift+A.");
  expect(emptyNotesHint(false, "Ctrl+Shift+A")).toMatch(/hover a line and click the plus/);
  // unbound: it does not name a key that does nothing
  expect(emptyNotesHint(true, "")).toMatch(/press the Add Review Note key/);
});
