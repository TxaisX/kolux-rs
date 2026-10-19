import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { joinPath, revealAt, searchSession, spotRange, summary, takeSpot, type Found } from "./search";

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

// FIX-4 (council d2 AFTER 1, 7): one search session per explorer view. An older answer never
// replaces a newer one, and closing the view lets the backend release the folder's search.
describe("FIX-4 the search session of one explorer view", () => {
  const ask = (query: string) => ({ query, matchCase: false, wholeWord: false, regex: false, include: "", exclude: "" });
  const deferred = () => {
    let ok: (f: Found) => void = () => {};
    let bad: (e: unknown) => void = () => {};
    const p = new Promise<Found>((a, b) => ((ok = a), (bad = b)));
    return { p, ok, bad };
  };

  it("drops the answer of an older search once a newer one was asked", async () => {
    const first = deferred();
    const second = deferred();
    const calls = [first, second];
    const s = searchSession("C:/r", () => calls.shift()!.p, () => {});
    const seen: string[] = [];
    s.run(ask("a"), (f) => seen.push(`a:${f.total}`), (e) => seen.push(`a!${e}`));
    s.run(ask("ab"), (f) => seen.push(`ab:${f.total}`), (e) => seen.push(`ab!${e}`));
    second.ok(found(2, 1));
    first.ok(found(9, 9));
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual(["ab:2"]);
  });

  it("drops the older search's failure too", async () => {
    const first = deferred();
    const second = deferred();
    const calls = [first, second];
    const s = searchSession("C:/r", () => calls.shift()!.p, () => {});
    const seen: string[] = [];
    s.run(ask("a"), () => seen.push("a ok"), () => seen.push("a failed"));
    s.run(ask("ab"), () => seen.push("ab ok"), () => seen.push("ab failed"));
    first.bad("A newer search of this folder replaced this one.");
    second.ok(found(1, 1));
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(["ab ok"]);
  });

  it("drops a search nobody wants any more (empty query) and an answer after the view closed", async () => {
    const one = deferred();
    const cancelled: string[] = [];
    const s = searchSession("C:/r", () => one.p, (r) => void cancelled.push(r));
    const seen: string[] = [];
    s.run(ask("a"), () => seen.push("late"), () => seen.push("late"));
    s.close();
    one.ok(found(1, 1));
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([]);
    expect(cancelled).toEqual(["C:/r"]);
  });

  it("asks the backend to release the folder when a view that searched closes, once, and not when it never searched", () => {
    const cancelled: string[] = [];
    const idle = searchSession("C:/idle", () => new Promise<Found>(() => {}), (r) => void cancelled.push(r));
    idle.close();
    expect(cancelled).toEqual([]);
    const used = searchSession("C:/used", () => new Promise<Found>(() => {}), (r) => void cancelled.push(r));
    used.run(ask("x"), () => {}, () => {});
    used.close();
    used.close();
    expect(cancelled).toEqual(["C:/used"]);
  });
});
