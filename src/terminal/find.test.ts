import { describe, expect, it, vi } from "vitest";
import { compile, countLabel, findIn, linesOf, MATCH_CAP, nearestFrom, placeMatches, QUERY_CAP, REGEX_BUDGET, REGEX_DELAY, searchLater, segments, stepIndex, type Cell, type Runner } from "./find";

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

describe("TERM-077 find: cells, wrapped lines and a capped regex", () => {
  const cols = 10;
  const find = (rows: Parameters<typeof linesOf>[0], q: string, opts = plain) => {
    const lines = linesOf(rows, cols);
    return placeMatches(lines, findIn(lines.map((l) => l.text), q, opts), cols);
  };
  // A wide character is one index and two cells: the second cell has width 0.
  const wide = (s: string): Cell[] => [...s].flatMap((ch) => (ch.charCodeAt(0) > 0x2e80 ? [{ chars: ch, width: 2 }, { chars: "", width: 0 }] : [{ chars: ch, width: 1 }]));

  it("marks the right cells after wide characters", () => {
    // "日本 err": 日 cells 0-1, 本 cells 2-3, space 4, err 5-7.
    expect(find([{ wrapped: false, cells: wide("日本 err") }], "err")).toEqual([{ row: 0, col: 5, len: 3 }]);
    // A wide character in the match spans both its cells.
    expect(find([{ wrapped: false, cells: wide("ab日c") }], "b日c")).toEqual([{ row: 0, col: 1, len: 4 }]);
  });

  it("finds a match a long line wrapped across two rows, and cuts its mark per row", () => {
    const rows = [
      { wrapped: false, cells: "xxxxxxxerr" },
      { wrapped: true, cells: "or here   " },
      { wrapped: false, cells: "error     " },
    ];
    const m = find(rows, "error");
    expect(m).toEqual([{ row: 0, col: 7, len: 5 }, { row: 2, col: 0, len: 5 }]);
    expect(segments(m[0], cols)).toEqual([{ row: 0, col: 7, len: 3 }, { row: 1, col: 0, len: 2 }]);
    expect(segments(m[1], cols)).toEqual([m[1]]);
    // An unwrapped row never joins the one above it.
    expect(find([{ wrapped: false, cells: "xxxxxxxerr" }, { wrapped: false, cells: "or        " }], "error")).toEqual([]);
  });

  it("waits for typing to stop before running a regex, and runs it once", () => {
    vi.useFakeTimers();
    try {
      const runs: string[] = [];
      const spawn = (): Runner => ({ run: (_t, q, _o, done) => (runs.push(q), done([])), stop: () => {} });
      let cancel = searchLater(() => ["a"], "a", { ...plain, regex: true }, () => {}, () => {}, spawn);
      vi.advanceTimersByTime(REGEX_DELAY - 1);
      cancel();
      cancel = searchLater(() => ["ab"], "ab", { ...plain, regex: true }, () => {}, () => {}, spawn);
      vi.advanceTimersByTime(REGEX_DELAY);
      expect(runs).toEqual(["ab"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops a regex that runs past its budget and says it took too long", () => {
    vi.useFakeTimers();
    try {
      let stopped = 0;
      let late: ((h: { row: number; col: number; len: number }[]) => void) | undefined;
      const spawn = (): Runner => ({ run: (_t, _q, _o, done) => void (late = done), stop: () => void stopped++ });
      const done = vi.fn();
      const slow = vi.fn();
      searchLater(() => ["aaaa"], "(a+)+$", { ...plain, regex: true }, done, slow, spawn);
      vi.advanceTimersByTime(REGEX_DELAY + REGEX_BUDGET);
      expect(slow).toHaveBeenCalledTimes(1);
      expect(stopped).toBe(1);
      late?.([{ row: 0, col: 0, len: 4 }]); // an answer after the stop is ignored
      expect(done).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
