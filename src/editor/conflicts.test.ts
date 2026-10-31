import { describe, expect, it } from "vitest";
import { findConflicts, stepConflict } from "./conflicts";

const FILE = [
  "intro", //                       1
  "<<<<<<< HEAD", //                2
  "ours one", //                    3
  "=======", //                     4
  "theirs one", //                  5
  ">>>>>>> feature", //             6
  "middle", //                      7
  "<<<<<<< HEAD", //                8
  "ours two", //                    9
  "||||||| base", //                10
  "base two", //                    11
  "=======", //                     12
  "theirs two", //                  13
  ">>>>>>> feature", //             14
  "end", //                         15
];

describe("EDIT-009 conflict regions", () => {
  it("finds both conflicts, with the base section of a diff3 one", () => {
    expect(findConflicts(FILE)).toEqual([
      { start: 2, base: null, mid: 4, end: 6 },
      { start: 8, base: 10, mid: 12, end: 14 },
    ]);
  });

  it("ignores half-written markers and look-alikes", () => {
    expect(findConflicts(["<<<<<<< HEAD", "a", "=======", "no end"])).toEqual([]);
    expect(findConflicts(["<<<<<<<<< too long", "=======", ">>>>>>> x"])).toEqual([]);
    expect(findConflicts(["======= trailing", ">>>>>>> x"])).toEqual([]);
    // A second start before the first ends restarts the region.
    expect(findConflicts(["<<<<<<< a", "<<<<<<< b", "x", "=======", "y", ">>>>>>> c"])).toEqual([{ start: 2, base: null, mid: 4, end: 6 }]);
  });

  it("reads Windows line ends", () => {
    expect(findConflicts("<<<<<<< HEAD\r\na\r\n=======\r\nb\r\n>>>>>>> x\r\n".split("\n"))).toEqual([{ start: 1, base: null, mid: 3, end: 5 }]);
  });
});

describe("EDIT-009 stepping wraps both ways", () => {
  const list = findConflicts(FILE);
  it("next conflict twice from the first comes back to the first", () => {
    const second = stepConflict(list, 2, 1);
    expect(second).toBe(1);
    expect(stepConflict(list, list[second!].start, 1)).toBe(0);
  });

  it("previous from the first conflict is the last one in the file", () => {
    expect(stepConflict(list, 2, -1)).toBe(1);
    expect(stepConflict(list, 3, -1)).toBe(1); // inside the first one too
  });

  it("steps from between and outside conflicts", () => {
    expect(stepConflict(list, 1, 1)).toBe(0);
    expect(stepConflict(list, 7, 1)).toBe(1);
    expect(stepConflict(list, 7, -1)).toBe(0);
    expect(stepConflict(list, 15, 1)).toBe(0);
    expect(stepConflict(list, 15, -1)).toBe(1);
    expect(stepConflict([], 1, 1)).toBeNull();
  });
});
