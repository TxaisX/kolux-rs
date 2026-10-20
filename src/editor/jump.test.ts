import { describe, expect, it } from "vitest";
import { hasSpot, jumpSpot, revealAt, spotRange, takeSpot } from "./search";

// TERM-093 (T-222-c): a path:line printed in a terminal opens the file at that line.
const doc = { lines: 3, line: (n: number) => ({ from: (n - 1) * 10, length: 9 }) };

describe("jump to a printed line", () => {
  it("lands at the start of that line, with nothing selected", () => {
    expect(spotRange(doc, jumpSpot(2))).toEqual({ from: 10, to: 10 });
  });

  it("a line past the end of the file (it changed since) lands on the last line, line 0 on the first", () => {
    expect(spotRange(doc, jumpSpot(42)).from).toBe(20);
    expect(spotRange(doc, jumpSpot(0)).from).toBe(0);
  });

  it("waits for the tab to take it, once, by either slash on Windows", () => {
    revealAt(String.raw`C:\w\src\app.ts`, jumpSpot(42));
    expect(hasSpot("c:/w/src/app.ts")).toBe(true);
    expect(takeSpot("C:/w/src/app.ts")).toEqual({ line: 42, col: 0, len: 0 });
    expect(takeSpot("C:/w/src/app.ts")).toBeNull();
  });
});
