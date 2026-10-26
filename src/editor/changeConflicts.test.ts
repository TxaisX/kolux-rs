import { describe, expect, it } from "vitest";
import { clashesOf, relPath, withClashes } from "./changeConflicts";
import { estimate, tagOf, type Entry } from "./AllChangesPane";
import { emptyStatus } from "../scm/model";

const e = (path: string, over: Partial<Entry> = {}): Entry => ({ path, staged: false, code: "M", lines: 3, binary: false, stamp: "x", ...over });
const status = (...conflicts: [string, string][]) => ({ ...emptyStatus, conflicts: conflicts.map(([path, status]) => ({ path, status, from: null })) });

describe("T-227-d: conflicted files in All Changes", () => {
  it("reads an entry's worktree-relative path whatever the slashes", () => {
    expect(relPath("C:\\r", "C:\\r\\src\\a.ts")).toBe("src/a.ts");
    expect(relPath("C:/r/", "C:/r/src/a.ts")).toBe("src/a.ts");
  });
  it("lists a conflicted file once, first, marked with its clash; the others keep their order", () => {
    const list = [e("C:/r/a.ts"), e("C:/r/clash.ts", { staged: true, code: "U" }), e("C:/r/clash.ts", { code: "U" }), e("C:/r/b.ts")];
    const out = withClashes(list, clashesOf(status(["clash.ts", "UU"])), "C:/r");
    expect(out.map((x) => x.path)).toEqual(["C:/r/clash.ts", "C:/r/a.ts", "C:/r/b.ts"]);
    expect(out[0].clash).toBe("UU");
    expect(out.slice(1).every((x) => x.clash === undefined)).toBe(true);
  });
  it("changes nothing when no file is in conflict", () => {
    const list = [e("C:/r/a.ts")];
    expect(withClashes(list, clashesOf(status()), "C:/r")).toBe(list);
    expect(clashesOf(null).size).toBe(0);
  });
  it("words a conflicted section as a conflict and gives it a small fixed height", () => {
    const c = e("C:/r/clash.ts", { clash: "UU" });
    expect(tagOf(c, false)).toBe("Conflict");
    expect(tagOf(c, true)).toBe("Conflict");
    expect(estimate(c)).toBeLessThan(100);
  });
});
