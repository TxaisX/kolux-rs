import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { joinPath, revealAt, spotRange, summary, takeSpot, type Found } from "./search";

const found = (total: number, files: number, more: Partial<Found> = {}): Found => ({
  files: Array.from({ length: files }, (_, i) => ({ path: `f${i}`, hits: [] })),
  total,
  capped: false,
  source: "rg",
  ...more,
});

describe("EDIT-037 search across the worktree", () => {
  it("puts a result's path under the worktree in the worktree's own style", () => {
    expect(joinPath("C:\\work\\repo\\", "sub/b.ts")).toBe("C:\\work\\repo\\sub\\b.ts");
    expect(joinPath("/home/me/repo", "sub/b.ts")).toBe("/home/me/repo/sub/b.ts");
  });

  it("says how many it found, when the list was cut, and when git searched instead", () => {
    expect(summary(found(0, 0))).toBe("No results.");
    expect(summary(found(1, 1))).toBe("1 result in 1 file.");
    expect(summary(found(2000, 3, { capped: true }))).toBe("2000 results in 3 files. Only the first 2000 are shown; narrow the search to see the rest.");
    expect(summary(found(4, 2, { source: "git" }))).toContain("ripgrep was not found");
  });

  it("hands a hit to the file's tab once, matching the path however its case and slashes are written", () => {
    revealAt("C:\\Repo\\a.ts", { line: 2, col: 3, len: 4 });
    expect(takeSpot("c:/repo/A.ts")).toEqual({ line: 2, col: 3, len: 4 });
    expect(takeSpot("c:/repo/A.ts")).toBeNull();
  });

  it("lands on the hit, and stays inside a file that got shorter since the search", () => {
    const doc = Text.of(["one", "two todo", "three"]);
    expect(spotRange(doc, { line: 2, col: 4, len: 4 })).toEqual({ from: 8, to: 12 });
    expect(spotRange(doc, { line: 9, col: 99, len: 4 })).toEqual({ from: 18, to: 18 });
  });
});
