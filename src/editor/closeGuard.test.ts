import { describe, expect, it } from "vitest";
import { askText, closable, saveAll, unsavedTabs, unusedNotes, type GuardPane, type SaveIo, type Unsaved } from "./closeGuard";
import { isUntitled } from "./untitled";

const panes: GuardPane[] = [
  { key: 1, kind: "editor", path: "C:/w/a.ts", cwd: "C:/w" },
  { key: 2, kind: "editor", path: "C:/w/b.ts", cwd: "C:/w" },
  { key: 3, kind: "editor", path: "C:/w/c.ts", cwd: "C:/w" },
  { key: 4, kind: "diff", path: "C:/w/d.ts", cwd: "C:/w" },
  { key: 5 }, // a terminal
  { key: 6, kind: "editor", path: "C:/w/untitled.md", cwd: "C:/w" },
];
const dirty = { 2: true, 4: true, 5: true, 6: true };

describe("EDIT-031 closing never drops unsaved edits (T-236-b)", () => {
  it("finds the unsaved file tabs among the keys, once each, in order, and ignores terminals and clean tabs", () => {
    expect(unsavedTabs([1, 2, 3, 4, 5, 6, 2], panes, dirty).map((u) => u.key)).toEqual([2, 4, 6]);
    expect(unsavedTabs([1, 3], panes, dirty)).toEqual([]);
  });

  // close others / all / to the right: the key sets App builds are plain arrays, so one rule covers them all.
  it.each([
    ["close others from tab 1", [2, 3, 4, 5, 6]],
    ["close all", [1, 2, 3, 4, 5, 6]],
    ["close to the right of tab 2", [3, 4, 5, 6]],
    ["close one", [2]],
  ])("%s: an unsaved tab is never closable without a choice, and Cancel closes nothing", (_n, keys) => {
    const u = unsavedTabs(keys, panes, dirty);
    expect(u.length).toBeGreaterThan(0); // so the prompt is asked
    expect(closable("cancel", keys, u, new Set())).toEqual([]);
    // Save with nothing saved: every unsaved tab stays open, the clean ones close.
    const left = closable("save", keys, u, new Set());
    for (const t of u) expect(left).not.toContain(t.key);
    expect([...left].sort()).toEqual(keys.filter((k) => !u.some((t) => t.key === k)).sort());
  });

  it("Save closes the saved tabs and keeps one that failed; Don't save closes all", () => {
    const keys = [1, 2, 3, 4];
    const u = unsavedTabs(keys, panes, dirty);
    expect(closable("save", keys, u, new Set([2]))).toEqual([1, 2, 3]);
    expect(closable("save", keys, u, new Set([2, 4]))).toEqual([1, 2, 3, 4]);
    expect(closable("discard", keys, u, new Set())).toEqual(keys);
  });

  it("saves one after another; a throw, a refused name or a stale file leaves that tab unsaved", async () => {
    const log: string[] = [];
    const isDirty = new Set(["C:/w/b.ts", "C:/w/d.ts", "C:/w/untitled.md"]);
    const io: SaveIo = {
      dirty: (p) => isDirty.has(p),
      needsName: (t) => t.path.endsWith("untitled.md"),
      write: async (t) => {
        log.push("w" + t.key);
        if (t.key === 4) throw new Error("disk full");
        isDirty.delete(t.path);
        return true;
      },
      name: async (t) => (log.push("n" + t.key), false),
    };
    const saved = await saveAll(unsavedTabs([2, 4, 6], panes, dirty), io);
    expect([...saved]).toEqual([2]);
    expect(log).toEqual(["w2", "w4", "n6"]);
  });

  it("a twin tab already saved by the first write needs no second write", async () => {
    const u: Unsaved[] = [
      { key: 1, path: "C:/w/x.ts", root: "C:/w" },
      { key: 2, path: "C:/w/x.ts", root: "C:/w" },
    ];
    let still = true;
    let writes = 0;
    const saved = await saveAll(u, { dirty: () => still, needsName: () => false, name: async () => false, write: async () => ((writes++, (still = false), true)) });
    expect(writes).toBe(1);
    expect([...saved].sort()).toEqual([1, 2]);
  });

  it("words the dialog for one file and for many", () => {
    expect(askText(["a.ts"])).toBe("This file has unsaved changes: a.ts.");
    expect(askText(["a", "b", "c", "d", "e"])).toBe("These 5 files have unsaved changes: a, b, c and 2 more.");
  });
});

describe("EDIT-031 a note never typed in is removed on close", () => {
  const read = (m: Record<string, { text: string | null; disk: string | null }>) => (p: string) => m[p] ?? { text: null, disk: null };
  it("removes an empty untitled note, keeps typed, templated and unknown-worktree ones, and one a staying tab shows", () => {
    const closing: GuardPane[] = [
      { key: 1, kind: "editor", path: "C:/w/untitled.md", cwd: "C:/w" },
      { key: 2, kind: "editor", path: "C:/w/untitled-2.md", cwd: "C:/w" },
      { key: 3, kind: "editor", path: "C:/w/untitled-3.md", cwd: "C:/w" },
      { key: 4, kind: "editor", path: "C:/w/untitled-4.md", cwd: null },
      { key: 5, kind: "editor", path: "C:/w/untitled-5.md", cwd: "C:/w" },
    ];
    const staying: GuardPane[] = [{ key: 9, kind: "editor", path: "C:\\w\\Untitled-5.md", cwd: "C:/w" }];
    const m = {
      "C:/w/untitled.md": { text: "", disk: "" },
      "C:/w/untitled-2.md": { text: "typed", disk: "" },
      "C:/w/untitled-3.md": { text: "# From a template\n", disk: "# From a template\n" },
      "C:/w/untitled-4.md": { text: "", disk: "" },
      "C:/w/untitled-5.md": { text: "", disk: "" },
    };
    expect(unusedNotes(closing, staying, isUntitled, read(m))).toEqual(["C:/w/untitled.md"]);
  });
});
