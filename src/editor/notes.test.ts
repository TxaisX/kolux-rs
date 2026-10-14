import { expect, test } from "vitest";
import { lineOf, noteDraft, notesMarkdown, reviewOn, sendTargets, type Note } from "./notes";

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

test("EDIT-020: notes find their line whatever the line ends, and only running agents of this worktree are offered, latest change first", () => {
  expect(lineOf("one\r\ntwo\r\nthree\r\n", "three")).toBe(3);
  expect(noteDraft("src/a.ts", "", "const x = 1;", 12)).toEqual({ path: "src/a.ts", line: 12, quote: "const x = 1;" });
  const panes = [
    { key: 1, agent: "shell", cwd: "W" },
    { key: 2, agent: "claude", cwd: "W" },
    { key: 3, agent: "codex", cwd: "W" },
    { key: 4, agent: "claude", cwd: "OTHER" },
    { key: 5, agent: "claude", cwd: "W", kind: "editor" },
    { key: 6, agent: "claude", cwd: "W" },
  ];
  const now = 10 * 60000;
  const got = sendTargets(panes, (p) => p.cwd === "W" && p.key !== 6, { 2: { at: now - 3 * 60000 }, 3: { at: now - 10000 } }, now, (p) => `${p.agent} ${p.key}`);
  expect(got).toEqual([
    { key: 3, label: "codex 3", since: "changed just now" },
    { key: 2, label: "claude 2", since: "changed 3m ago" },
  ]);
  expect(sendTargets(panes.slice(1, 2), () => true, {}, now, () => "c")).toEqual([{ key: 2, label: "c", since: "no change yet" }]);
});
