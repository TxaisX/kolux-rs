import { describe, expect, it } from "vitest";
import { followMoves } from "./useFileMoves";

// EDIT-032 (T-177): the tabs follow a moved file; terminals and untouched tabs keep their identity.
const tabs = [
  { key: 1, kind: "editor", path: "C:/w/a.md" },
  { key: 2, kind: "diff", path: "C:/w/docs/b.md" },
  { key: 3, kind: "editor", path: "C:/w/other.md" },
  { key: 4 },
  { key: 5, kind: "browser", path: "C:/w/a.md" },
];

describe("tabs follow moved files", () => {
  it("a renamed file's tab takes the new path, and so does a tab under a moved folder", () => {
    const out = followMoves(tabs, [["C:/w/a.md", "C:/w/renamed.md"], ["C:/w/docs", "C:/w/old/docs"]]);
    expect(out.map((t) => t.path)).toEqual(["C:/w/renamed.md", "C:/w/old/docs/b.md", "C:/w/other.md", undefined, "C:/w/a.md"]);
    expect(out[2]).toBe(tabs[2]); // untouched tabs are the same objects
  });

  it("nothing moved returns the same list, so no render is forced", () => {
    expect(followMoves(tabs, [["C:/w/zzz.md", "C:/w/y.md"]])).toBe(tabs);
  });
});
