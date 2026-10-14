import { describe, expect, it } from "vitest";
import { compile, countLabel, findIn, MATCH_CAP, nearestFrom, QUERY_CAP, stepIndex } from "./find";

const plain = { caseSensitive: false, regex: false };

describe("TERM-077 find text in a terminal", () => {
  it("finds a word present 3 times and steps through all 3, wrapping both ways", () => {
    const lines = ["PS> echo error", "error: one", "fine", "another error here"];
    const m = findIn(lines, "error", plain);
    expect(m).toEqual([
      { row: 0, col: 9, len: 5 },
      { row: 1, col: 0, len: 5 },
      { row: 3, col: 8, len: 5 },
    ]);
    let at = nearestFrom(m, 0);
    expect(at).toBe(0);
    at = stepIndex(m.length, at, 1);
    expect(at).toBe(1);
    at = stepIndex(m.length, at, 1);
    expect(at).toBe(2);
    at = stepIndex(m.length, at, 1);
    expect(at).toBe(0);
    expect(stepIndex(m.length, 0, -1)).toBe(2);
    expect(countLabel(m.length, 2, "error")).toBe("3 of 3");
  });

  it("an invalid pattern shows no matches and the bar keeps working", () => {
    const lines = ["a(b", "a(b again"];
    expect(compile("a(", { ...plain, regex: true })).toBeNull();
    expect(findIn(lines, "a(", { ...plain, regex: true })).toEqual([]);
    expect(countLabel(0, -1, "a(")).toBe("No matches");
    // the same text as a plain search is fine, and a corrected pattern works
    expect(findIn(lines, "a(", plain)).toHaveLength(2);
    expect(findIn(lines, "a\\(b", { ...plain, regex: true })).toHaveLength(2);
    expect(stepIndex(0, -1, 1)).toBe(-1);
  });

  it("honours Match case, caps the query and the matches, and skips empty matches", () => {
    expect(findIn(["Error error ERROR"], "error", plain)).toHaveLength(3);
    expect(findIn(["Error error ERROR"], "error", { ...plain, caseSensitive: true })).toEqual([{ row: 0, col: 6, len: 5 }]);
    const long = "x".repeat(QUERY_CAP + 50);
    expect(findIn([long], long, plain)).toEqual([{ row: 0, col: 0, len: QUERY_CAP }]);
    expect(findIn(["aaaa"], "a*", { ...plain, regex: true })).toEqual([{ row: 0, col: 0, len: 4 }]);
    expect(findIn(["ab"], "x*", { ...plain, regex: true })).toEqual([]);
    const many = Array.from({ length: 600 }, () => "hit hit");
    expect(findIn(many, "hit", plain)).toHaveLength(MATCH_CAP);
    expect(countLabel(MATCH_CAP, 0, "hit")).toBe("1 of 1000+");
  });

  it("starts from the first match in view when the query changes", () => {
    const m = [
      { row: 2, col: 0, len: 1 },
      { row: 40, col: 0, len: 1 },
      { row: 90, col: 0, len: 1 },
    ];
    expect(nearestFrom(m, 30)).toBe(1);
    expect(nearestFrom(m, 100)).toBe(0);
    expect(nearestFrom([], 0)).toBe(-1);
  });
});
