import { describe, expect, it } from "vitest";
import { collect, hashText, restore, tidy, type Session } from "./session";

const A = "C:/w/app";
const B = "C:/w/lib";

describe("editor session restore (EDIT-004)", () => {
  it("collects each workspace's editor tabs, the tab in front, and only unsaved text as a draft", () => {
    const panes = [
      { key: 1, cwd: null },
      { key: 2, cwd: A, kind: "editor", path: A + "/one.ts" },
      { key: 3, cwd: A, group: 2, kind: "editor", path: A + "/two.md" },
      { key: 4, cwd: A, group: 2, kind: "preview", path: A + "/two.md" },
      { key: 5, cwd: A, group: 2, kind: "diff", path: A + "/one.ts" },
      { key: 6, cwd: B, kind: "editor", path: B + "/x.rs" },
    ];
    const got = collect(
      panes,
      (group) => (group === 2 ? 3 : group),
      (key) => (key === 3 ? { caret: 7, mode: "source" as const } : undefined),
      (path) => (path.endsWith("two.md") ? { text: "edited", base: "stamp" } : null),
    );
    expect(got).toEqual([
      { dir: A, front: A + "/two.md", tabs: [{ path: A + "/one.ts", kind: "editor" }, { path: A + "/two.md", kind: "editor", caret: 7, mode: "source", draft: "edited", base: "stamp" }, { path: A + "/two.md", kind: "preview" }] },
      { dir: B, front: B + "/x.rs", tabs: [{ path: B + "/x.rs", kind: "editor" }] },
    ]);
  });

  it("tidies repeated and broken entries instead of opening them twice", () => {
    const raw = [
      { dir: A, front: A + "/gone.ts", tabs: [{ path: A + "/one.ts", kind: "editor", draft: "d", caret: -3 }, { path: "c:/W/APP/one.ts", kind: "editor" }, { path: 5 }, null, { path: "", kind: "editor" }, { path: A + "/p.md", kind: "preview", draft: "never" }, { path: A + "/q.ts", kind: "weird", mode: "odd" }] },
      { dir: 7, tabs: [] },
      "junk",
      { dir: A + "/", tabs: [{ path: A + "/one.ts", kind: "editor" }] },
    ];
    expect(tidy(raw, [A])).toEqual([{ dir: A, front: null, tabs: [{ path: A + "/one.ts", kind: "editor", draft: "d" }, { path: A + "/p.md", kind: "preview" }, { path: A + "/q.ts", kind: "editor" }] }]);
    expect(tidy("not a list", [A])).toEqual([]);
    expect(tidy(null, [A])).toEqual([]);
  });

  it("moves a tab whose file belongs to another open project under that project, with its draft", () => {
    const raw: Session[] = [{ dir: A, front: B + "/x.rs", tabs: [{ path: A + "/one.ts", kind: "editor" }, { path: B + "/x.rs", kind: "editor", draft: "mine", caret: 2, mode: "rich" }] }];
    expect(tidy(raw, [A, B])).toEqual([
      { dir: A, front: null, tabs: [{ path: A + "/one.ts", kind: "editor" }] },
      { dir: B, front: B + "/x.rs", tabs: [{ path: B + "/x.rs", kind: "editor", draft: "mine", caret: 2, mode: "rich" }] },
    ]);
    // A nested worktree is the closer owner.
    const inner = A + "/wt/feature";
    expect(tidy([{ dir: A, front: null, tabs: [{ path: inner + "/f.ts", kind: "editor" }] }], [A, inner]).map((s) => s.dir)).toEqual([inner]);
    // A file in no known folder stays where it was.
    expect(tidy([{ dir: A, front: null, tabs: [{ path: "D:/else/f.ts", kind: "editor" }] }], [A])[0].tabs.length).toBe(1);
  });

  it("restores each workspace as one cell with the same tab in front", () => {
    const sessions: Session[] = [
      { dir: A, front: A + "/two.md", tabs: [{ path: A + "/one.ts", kind: "editor" }, { path: A + "/two.md", kind: "editor", draft: "edited", base: "h" }] },
      { dir: B, front: null, tabs: [{ path: B + "/x.rs", kind: "preview" }] },
    ];
    const r = restore(sessions, 10);
    expect(r.panes).toEqual([
      { key: 10, cwd: A, group: 10, kind: "editor", path: A + "/one.ts", start: {} },
      { key: 11, cwd: A, group: 10, kind: "editor", path: A + "/two.md", start: { draft: "edited", base: "h" } },
      { key: 12, cwd: B, group: 12, kind: "preview", path: B + "/x.rs", start: {} },
    ]);
    expect(r.front).toEqual({ 10: 11 });
    expect(r.next).toBe(13);
  });

  it("hashes text to a short stable stamp", () => {
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("abc")).not.toBe(hashText("abd"));
    expect(hashText("")).toMatch(/^[0-9a-f:]+$/);
  });
});
