import { expect, test } from "vitest";
import { lineOf, noteDraft, notesMarkdown, reviewOn, type Note } from "./notes";

test("GIT-042: a note needs a selection and finds the selected line", () => {
  const text = "# Title\n\nFirst para.\nSecond line with **bold** words.\n";
  expect(noteDraft("a.md", text, "   ")).toBe(null);
  expect(noteDraft("a.md", text, "")).toBe(null);
  expect(noteDraft("a.md", text, "First para.")).toEqual({ path: "a.md", line: 3, quote: "First para." });
  // The preview drops the markup; the line is still found from the first words.
  expect(lineOf(text, "Second line with bold words.")).toBe(4);
  expect(lineOf(text, "nowhere at all")).toBe(1);
  // The source editor knows its line already.
  expect(noteDraft("a.md", text, " x ", 7)).toEqual({ path: "a.md", line: 7, quote: "x" });
});

test("GIT-042: copied notes are grouped per file, ordered by line then time, and quote the selection", () => {
  const n = (path: string, line: number, time: number, quote: string, note: string): Note => ({ path, line, time, quote, note });
  const md = notesMarkdown([n("b.md", 2, 1, "B two", "fix b"), n("a.md", 9, 2, "A nine\nsecond line", "later"), n("a.md", 3, 5, "A three", "second note"), n("a.md", 3, 4, "A three", "first note")]);
  expect(md).toBe(["# Review notes", "", "## a.md", "", "Line 3:", "> A three", "", "first note", "", "Line 3:", "> A three", "", "second note", "", "Line 9:", "> A nine", "> second line", "", "later", "", "## b.md", "", "Line 2:", "> B two", "", "fix b", ""].join("\n"));
});

test("GIT-042: the Markdown review tools are on unless the setting turns them off", () => {
  expect(reviewOn({})).toBe(true);
  expect(reviewOn({ markdownReviewNotes: false })).toBe(false);
  expect(reviewOn({ markdownReviewNotes: true })).toBe(true);
});
