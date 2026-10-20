import { Text } from "@codemirror/state";
import { expect, test } from "vitest";
import { contextText, oldSideContext, quoteLines, richContext } from "./copyContext";

const doc = Text.of(Array.from({ length: 20 }, (_, i) => `line ${i + 1} text`));
const at = (line: number, col = 0) => doc.line(line).from + col;

test("EDIT-007: lines 10 to 14 copy headed by the path and the range; an end in column one leaves that line out", () => {
  expect(contextText(doc, at(10), doc.line(14).to, "src/a.ts")).toEqual({ text: "src/a.ts:10-14\nline 10 text\nline 11 text\nline 12 text\nline 13 text\nline 14 text", header: true });
  expect(contextText(doc, at(10), at(15), "src/a.ts").text).toBe("src/a.ts:10-14\nline 10 text\nline 11 text\nline 12 text\nline 13 text\nline 14 text");
  // Starting part-way into a line still names the lines the selection touches.
  expect(contextText(doc, at(3, 5), at(4, 4), "src/a.ts").text).toBe("src/a.ts:3-4\n3 text\nline");
});

test("EDIT-007: part of one line is bare text; a whole line keeps its header; no selection is a path:line reference", () => {
  expect(contextText(doc, at(7, 5), at(7, 7), "src/a.ts")).toEqual({ text: "7 ", header: false });
  expect(contextText(doc, at(7), doc.line(7).to, "src/a.ts")).toEqual({ text: "src/a.ts:7\nline 7 text", header: true });
  expect(contextText(doc, at(7), at(8), "src/a.ts")).toEqual({ text: "src/a.ts:7\nline 7 text", header: true });
  expect(contextText(doc, at(7, 3), at(7, 3), "src/a.ts")).toEqual({ text: "src/a.ts:7", header: true });
});

const note = "# Title\n\nSome words here.\n\n- first item\n- second item\n\nlast para";

test("EDIT-007 (T-132-b): copy in the rich view heads a whole line or several lines with the path and source range", () => {
  expect(richContext(note, "Some words here.", "n.md")).toEqual({ text: "n.md:3\nSome words here.", header: true });
  expect(richContext(note, "Title", "n.md")).toEqual({ text: "n.md:1\nTitle", header: true });
  expect(richContext(note, "first item\nsecond item", "n.md")).toEqual({ text: "n.md:5-6\nfirst item\nsecond item", header: true });
  expect(richContext(note, "Some words here.\n\nfirst item", "n.md")?.text.split("\n")[0]).toBe("n.md:3-5");
});

test("EDIT-007 (T-132-b): part of one line is bare text; nothing or text that is not in the note passes through", () => {
  expect(richContext(note, "words", "n.md")).toEqual({ text: "words", header: false });
  expect(richContext(note, "  ", "n.md")).toBeNull();
  expect(richContext(note, "", "n.md")).toBeNull();
  expect(richContext(note, "not in the note", "n.md")).toBeNull();
  expect(quoteLines("a\r\nb\r\nc", "b\nc")).toEqual({ from: 2, to: 3, whole: false });
});

test("EDIT-007 (T-132-b): a copy from a diff's old side marks its header; bare text stays bare", () => {
  expect(oldSideContext({ text: "a.ts:3-4\nx\ny", header: true })).toBe("a.ts:3-4 (before the change)\nx\ny");
  expect(oldSideContext({ text: "a.ts:7", header: true })).toBe("a.ts:7 (before the change)");
  expect(oldSideContext({ text: "part", header: false })).toBe("part");
});
