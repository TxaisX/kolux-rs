import { describe, expect, it } from "vitest";
import { askText, BIG_CHARS, BIG_LINES, measure, needsAsk } from "./bigDiff";

// EDIT-028 (T-177): the card's own case is a generated file of 50,000 lines.
const file = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");

describe("very large diffs ask first", () => {
  it("a 50,000-line generated file asks, an ordinary file does not", () => {
    expect(needsAsk({ original: "", modified: file(50000) })).toBe(true);
    expect(needsAsk({ original: file(50000), modified: file(50000) + "\nx" })).toBe(true);
    expect(needsAsk({ original: file(200), modified: file(201) })).toBe(false);
    expect(needsAsk({ original: "", modified: "" })).toBe(false);
  });

  it("the line limit is exact: at the limit draws, one over asks", () => {
    expect(needsAsk({ original: file(BIG_LINES), modified: "" })).toBe(false);
    expect(needsAsk({ original: file(BIG_LINES + 1), modified: "" })).toBe(true);
  });

  it("a few enormous lines (a minified bundle) ask by size", () => {
    expect(needsAsk({ original: "x".repeat(BIG_CHARS), modified: "y" })).toBe(true);
    expect(needsAsk({ original: "x".repeat(1000), modified: "y".repeat(1000) })).toBe(false);
  });

  it("the prompt names the file and the line count", () => {
    expect(measure({ original: "a\nb", modified: "a\nb\nc" }).lines).toBe(3);
    expect(askText("gen.json", { original: "", modified: file(50000) })).toContain("50,000 lines");
  });
});
