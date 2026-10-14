import { describe, expect, it } from "vitest";
import { findIn } from "./notefind";

const any = { matchCase: false, wholeWord: false };
const hits = (text: string, q: string, opts = any) => findIn(text, q, opts).map(([s, e]) => text.slice(s, e));

describe("EDIT-017 find in a rendered note", () => {
  it("ignores case until match case is ticked", () => {
    const text = "Total, total and TOTAL";
    expect(hits(text, "total")).toEqual(["Total", "total", "TOTAL"]);
    expect(hits(text, "total", { matchCase: true, wholeWord: false })).toEqual(["total"]);
  });

  it("whole word counts letters of every script, astral ones included, as word letters", () => {
    const w = { matchCase: false, wholeWord: true };
    expect(hits("cat catalog bobcat cat.", "cat", w)).toEqual(["cat", "cat"]);
    // Cyrillic and Chinese next to the word make it part of a longer word.
    expect(hits("кот котик", "кот", w)).toEqual(["кот"]);
    expect(findIn("猫cat", "cat", w)).toEqual([]);
    // U+1D400 (mathematical bold A) is a letter outside the basic range, so "cat" is not a whole word here.
    expect(findIn("\u{1D400}cat", "cat", w)).toEqual([]);
    expect(findIn("\u{1D400} cat", "cat", w)).toEqual([[3, 6]]);
    // An accent written as a combining mark belongs to the word too.
    expect(findIn("café", "cafe", w)).toEqual([]);
  });

  it("treats the query as plain text, so pattern characters never break it", () => {
    expect(hits("a (b) [c] a.b a+b \\d", "(b)")).toEqual(["(b)"]);
    expect(hits("a (b) [c] a.b axb", "a.b")).toEqual(["a.b"]);
    expect(hits("x [ y", "[")).toEqual(["["]);
    expect(hits("\\d 5", "\\d")).toEqual(["\\d"]);
    expect(findIn("anything", "", any)).toEqual([]);
  });

  it("finds non-overlapping matches in order", () => {
    expect(findIn("aaaa", "aa", any)).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });
});
