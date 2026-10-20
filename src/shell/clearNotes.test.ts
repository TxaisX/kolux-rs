import { describe, expect, it } from "vitest";
import { clearQuestion, needsConfirm } from "./clearNotes";

describe("view-072 clearing review notes", () => {
  it("one note clears at once; two or more ask first", () => {
    expect([0, 1, 2, 7].map(needsConfirm)).toEqual([false, false, true, true]);
  });
  it("the question names how many and, for a file, which", () => {
    expect(clearQuestion(3)).toBe("Clear 3 notes?");
    expect(clearQuestion(1)).toBe("Clear 1 note?");
    expect(clearQuestion(2, "src/a.ts")).toBe("Clear 2 notes on src/a.ts?");
  });
});
