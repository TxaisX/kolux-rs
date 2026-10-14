import { describe, expect, it } from "vitest";
import { baseCall, entryKey, estimate, sidesCall, tagOf, WAIT_OVER, type Entry } from "./AllChangesPane";
import { AC_SPLIT_KEY, AC_TREE_KEY, AC_WHITESPACE_KEY, AC_WRAP_KEY, acLayoutOf, emptyStatus } from "../scm/model";

const e = (over: Partial<Entry>): Entry => ({ path: "C:/r/a.ts", staged: false, code: "M", lines: 10, binary: false, stamp: "x", ...over });

describe("All Changes sections", () => {
  it("keeps a file's staged and unstaged change apart", () => {
    expect(entryKey(e({ staged: true }))).not.toBe(entryKey(e({ staged: false })));
  });
  it("reserves a height that grows with the change up to a ceiling", () => {
    expect(estimate(e({ lines: 10 }))).toBeLessThan(estimate(e({ lines: 100 })));
    expect(estimate(e({ lines: 1000 }))).toBe(estimate(e({ lines: 1500 })));
  });
  it("gives a waiting, binary or image section a small fixed height", () => {
    expect(estimate(e({ lines: WAIT_OVER + 1 }))).toBeLessThan(100);
    expect(estimate(e({ lines: null, binary: true }))).toBeLessThan(100);
    expect(estimate(e({ path: "C:/r/logo.png", lines: null, binary: true }))).toBeLessThan(100);
  });
});

describe("GIT-038: All Changes against the branch's base", () => {
  it("reads a section's sides from the base snapshot, or from the index as before", () => {
    const base = { against: "main", since: "abc123" };
    expect(sidesCall(base, "C:/r", e({}))).toEqual(["scm_base_sides", { worktree: "C:/r", path: "C:/r/a.ts", since: "abc123" }]);
    expect(sidesCall(null, "C:/r", e({ staged: true }))).toEqual(["diff_sides", { path: "C:/r/a.ts", staged: true }]);
  });
  it("words a section by what became of the file against the base, by index side otherwise", () => {
    expect(tagOf(e({ code: "A" }), true)).toBe("Added");
    expect(tagOf(e({ code: "D" }), true)).toBe("Deleted");
    expect(tagOf(e({ code: "M" }), true)).toBe("Changed");
    expect(tagOf(e({ code: "?" }), true)).toBe("Untracked");
    expect(tagOf(e({ code: "M", staged: true }), false)).toBe("Staged");
    expect(tagOf(e({ code: "M" }), false)).toBe("Unstaged");
  });
  it("starts inline, unwrapped, whitespace hidden and the tree hidden unless a setting says otherwise", () => {
    expect(acLayoutOf(null)).toEqual({ split: false, wrap: false, spaces: false, tree: false });
    expect(acLayoutOf({ [AC_SPLIT_KEY]: true, [AC_WRAP_KEY]: "yes", [AC_WHITESPACE_KEY]: true, [AC_TREE_KEY]: true })).toEqual({ split: true, wrap: false, spaces: true, tree: true });
  });
});

describe("T-033-g: All Changes reads its base without a second status", () => {
  it("passes the base the last status named, and none before any status arrived", () => {
    expect(baseCall("C:/r", null, { ...emptyStatus, base: "main" })).toEqual(["scm_base_changes", { worktree: "C:/r", pinned: null, known: "main" }]);
    expect(baseCall("C:/r", "release", { ...emptyStatus, base: "main" })).toEqual(["scm_base_changes", { worktree: "C:/r", pinned: "release", known: "main" }]);
    expect(baseCall("C:/r", null, null)).toEqual(["scm_base_changes", { worktree: "C:/r", pinned: null, known: null }]);
    expect(baseCall("C:/r", null, emptyStatus)).toEqual(["scm_base_changes", { worktree: "C:/r", pinned: null, known: null }]);
  });
});
