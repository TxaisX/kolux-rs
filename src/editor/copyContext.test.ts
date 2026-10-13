import { Text } from "@codemirror/state";
import { expect, test } from "vitest";
import { contextText } from "./copyContext";

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
