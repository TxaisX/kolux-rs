import { expect, test } from "vitest";
import { anchorIndex, placeRail, railItems, railNotes } from "./rail";
import type { Note } from "./notes";

const note = (path: string, line: number, time: number, quote = "q"): Note => ({ path, line, time, quote, note: "n" });

test("EDIT-020 (T-132-b): the rail lists only this file's notes, by source line then time, whatever the slash or case", () => {
  const all = [note("C:\\w\\a.md", 9, 1), note("c:/w/A.md", 2, 5), note("C:\\w\\b.md", 1, 1), note("C:\\w\\a.md", 2, 3)];
  expect(railNotes(all, "C:/w/a.md").map((n) => [n.line, n.time])).toEqual([[2, 3], [2, 5], [9, 1]]);
  expect(railNotes([], "C:/w/a.md")).toEqual([]);
});

test("EDIT-020 (T-132-b): cards sit beside their text, and ones that would overlap are pushed down in order", () => {
  const out = placeRail([
    { id: "a", top: 100, height: 50 },
    { id: "b", top: 120, height: 50 }, // would overlap a
    { id: "c", top: 400, height: 50 }, // far enough to keep its place
    { id: "d", top: 410, height: 50 },
  ]);
  expect(out).toEqual({ a: 100, b: 156, c: 400, d: 456 });
  expect(placeRail([])).toEqual({});
});

test("EDIT-020 (T-132-b): a note whose text is gone sits below the last placed card, not at the top", () => {
  const items = railItems([note("p", 1, 1), note("p", 2, 2), note("p", 3, 3)], [200, null, 500], 50);
  expect(items.map((i) => i.top)).toEqual([200, 200, 500]);
  expect(Object.values(placeRail(items))).toEqual([200, 256, 500]);
});

test("EDIT-020 (T-132-b): a quote is found by its first line, or its first three words when the markup changed the rest", () => {
  const texts = ["Title", "Some words here.", "more"];
  expect(anchorIndex(texts, "\n  Some words here.\nmore")).toBe(1);
  expect(anchorIndex(texts, "Some words here and then more")).toBe(1);
  expect(anchorIndex(texts, "absent text")).toBe(-1);
  expect(anchorIndex(texts, "   ")).toBe(-1);
});
