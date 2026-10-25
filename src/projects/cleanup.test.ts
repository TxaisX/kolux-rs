import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_VIEW, arrangeRows, childrenFirst, needsSizes, sizeText, addKept, forgetCleanupMemory, keptAfter, keptBatches, keptView, lastScan, preselected, rememberScan, rememberShowAll, rememberedShowAll, rowFacts, rowLabel, shownRows, tickedPaths, ticksAfterScan, type KeptItem, type Scan, type ScanRow } from "./cleanup";

const row = (path: string, over: Partial<ScanRow> = {}): ScanRow => ({
  path,
  branch: path.split("/").pop() ?? null,
  name: null,
  idleDays: 12,
  changes: 0,
  merged: false,
  unmerged: false,
  active: false,
  locked: false,
  missing: false,
  quiet: true,
  preselect: true,
  keepsBranch: false,
  note: null,
  ...over,
});
const scan = (rows: ScanRow[], over: Partial<Scan> = {}): Scan => ({ projectId: "p", rows, error: null, timedOut: false, atMs: 1, ...over });

beforeEach(() => forgetCleanupMemory());

describe("PROJ-080 the cleanup list", () => {
  it("opens with three idle, clean workspaces all preselected", () => {
    const s = scan([row("/w/a"), row("/w/b"), row("/w/c")]);
    expect(preselected(s)).toEqual(["/w/a", "/w/b", "/w/c"]);
    expect(Object.values(ticksAfterScan(null, s))).toEqual([true, true, true]);
  });

  it("does not preselect a workspace with changes, a terminal or a lock, and lists only quiet ones until show all", () => {
    const s = scan([row("/w/ok"), row("/w/dirty", { changes: 2, preselect: false }), row("/w/busy", { active: true, preselect: false }), row("/w/new", { quiet: false, preselect: false, idleDays: 0 })]);
    expect(preselected(s)).toEqual(["/w/ok"]);
    expect(shownRows(s, false).map((r) => r.path)).toEqual(["/w/ok", "/w/dirty", "/w/busy"]);
    expect(shownRows(s, true)).toHaveLength(4);
  });

  it("keeps the user's ticks over a rescan, drops vanished rows and applies the preselect to new ones", () => {
    const first = scan([row("/w/a"), row("/w/b")]);
    const ticks = { ...ticksAfterScan(null, first), "/w/a": false };
    const again = scan([row("/w/a"), row("/w/c"), row("/w/d", { preselect: false })]);
    expect(ticksAfterScan(ticks, again)).toEqual({ "/w/a": false, "/w/c": true, "/w/d": false });
  });

  it("only ticked rows that are shown are removed", () => {
    const s = scan([row("/w/a"), row("/w/hidden", { quiet: false, preselect: false })]);
    const ticks = { "/w/a": true, "/w/hidden": true };
    expect(tickedPaths(ticks, s, false)).toEqual(["/w/a"]);
    expect(tickedPaths(ticks, s, true)).toEqual(["/w/a", "/w/hidden"]);
  });

  it("shows the previous result at once and keeps the filter; a failed scan never replaces it", () => {
    expect(lastScan("p")).toBeNull();
    const good = scan([row("/w/a")]);
    rememberScan(good);
    rememberShowAll("p", true);
    expect(lastScan("p")).toBe(good);
    expect(rememberedShowAll("p")).toBe(true);
    rememberScan(scan([], { error: "Scanning took longer than 60 seconds", timedOut: true }));
    expect(lastScan("p")).toBe(good);
  });

  it("explains each row in plain words", () => {
    expect(rowFacts(row("/w/a"))).toBe("idle 12 days · clean");
    expect(rowFacts(row("/w/a", { idleDays: 1, merged: true, changes: 1, active: true, keepsBranch: true }))).toBe("idle 1 day · merged · 1 uncommitted change · a terminal is open · its branch stays");
    expect(rowFacts(row("/w/a", { missing: true, idleDays: null }))).toBe("folder is gone");
    expect(rowFacts(row("/w/a", { unmerged: true, preselect: false }))).toBe("idle 12 days · unmerged commits · clean");
    expect(rowFacts(row("/w/a", { merged: true }))).not.toContain("unmerged");
    expect(rowFacts(row("/w/a", { note: "Its details could not be read: timed out" }))).toContain("could not be read");
    expect(rowLabel(row("/w/a", { name: "Otter run" }))).toBe("Otter run");
    expect(rowLabel(row("C:\\w\\fox", { branch: null }))).toBe("fox");
  });
});

describe("PROJ-073 kept branches", () => {
  const k = (projectId: string, branch: string): KeptItem => ({ projectId, branch, commit: "abc1234" });

  it("one branch is a toast and a batch is one review list", () => {
    expect(keptView([])).toBe("none");
    expect(keptView([k("p", "a")])).toBe("toast");
    expect(keptView(addKept([k("p", "a")], [k("p", "b"), k("q", "c")]))).toBe("review");
  });

  it("a branch listed twice is listed once, with the newest commit", () => {
    const out = addKept([k("p", "a")], [{ projectId: "p", branch: "a", commit: "def5678" }]);
    expect(out).toEqual([{ projectId: "p", branch: "a", commit: "def5678" }]);
  });

  it("only ticked branches are sent, grouped per project in order", () => {
    const items = [k("p", "a"), k("q", "b"), k("p", "c")];
    const batches = keptBatches(items, { "p\na": true, "p\nc": true });
    expect(batches).toEqual([{ projectId: "p", items: [{ branch: "a", commit: "abc1234" }, { branch: "c", commit: "abc1234" }] }]);
    expect(keptBatches(items, {})).toEqual([]);
  });

  it("a refused branch stays on the list and a deleted one leaves it", () => {
    const left = keptAfter([k("p", "a"), k("p", "b")], [{ branch: "a", deleted: true, why: null }, { branch: "b", deleted: false, why: "The branch has moved since you were asked" }]);
    expect(left.map((x) => x.branch)).toEqual(["b"]);
  });
});

describe("PROJ-081 cleanup filters, search and sorting", () => {
  const big = row("w/big", { merged: true });
  const small = row("w/small", { unmerged: true, preselect: false });
  const unknown = row("w/unknown", { changes: 2, preselect: false });
  const never = row("w/never", { idleDays: null });
  const gone = row("w/gone", { missing: true, idleDays: null });
  const all = [unknown, small, never, big, gone];
  const sizes = { "w/big": 900 * 1024 * 1024, "w/small": 10, "w/never": 5000, "w/gone": null };

  it("sort by size, largest first: rows without a size are last", () => {
    const v = { ...DEFAULT_VIEW, sort: "size" as const, desc: true };
    expect(arrangeRows(all, v, sizes).map((r) => r.path)).toEqual(["w/big", "w/never", "w/small", "w/unknown", "w/gone"]);
    expect(arrangeRows(all, { ...v, desc: false }, sizes).map((r) => r.path)).toEqual(["w/small", "w/never", "w/big", "w/unknown", "w/gone"]);
  });

  it("filter by Git state keeps only matching rows", () => {
    expect(arrangeRows(all, { ...DEFAULT_VIEW, git: "merged" }).map((r) => r.path)).toEqual(["w/big"]);
    expect(arrangeRows(all, { ...DEFAULT_VIEW, git: "unmerged" }).map((r) => r.path)).toEqual(["w/small"]);
    expect(arrangeRows(all, { ...DEFAULT_VIEW, git: "changes" }).map((r) => r.path)).toEqual(["w/unknown"]);
    expect(arrangeRows(all, { ...DEFAULT_VIEW, git: "missing" }).map((r) => r.path)).toEqual(["w/gone"]);
    expect(arrangeRows(all, { ...DEFAULT_VIEW, git: "clean" }).map((r) => r.path)).toEqual(["w/small", "w/never", "w/big"]);
  });

  it("activity, safety, size filters and search narrow the list; idle sort puts never-visited rows last", () => {
    expect(arrangeRows(all, { ...DEFAULT_VIEW, activity: "never" }).map((r) => r.path)).toEqual(["w/never"]);
    expect(arrangeRows(all, { ...DEFAULT_VIEW, safety: "safe" }).map((r) => r.path)).toEqual(["w/never", "w/big", "w/gone"]);
    expect(arrangeRows(all, { ...DEFAULT_VIEW, size: "large" }, sizes).map((r) => r.path)).toEqual(["w/big"]);
    expect(arrangeRows(all, { ...DEFAULT_VIEW, query: "SMA" }).map((r) => r.path)).toEqual(["w/small"]);
    expect(arrangeRows(all, { ...DEFAULT_VIEW, query: "uncommitted" }).map((r) => r.path)).toEqual(["w/unknown"]);
    const idle = arrangeRows([never, row("w/a", { idleDays: 3 }), row("w/b", { idleDays: 30 })], { ...DEFAULT_VIEW, sort: "idle", desc: true });
    expect(idle.map((r) => r.path)).toEqual(["w/b", "w/a", "w/never"]);
    expect(arrangeRows(all, DEFAULT_VIEW)).toEqual(all);
  });

  it("sizes are read only when a size filter or the size sort needs them", () => {
    expect(needsSizes(DEFAULT_VIEW)).toBe(false);
    expect(needsSizes({ ...DEFAULT_VIEW, git: "merged", sort: "name" })).toBe(false);
    expect(needsSizes({ ...DEFAULT_VIEW, sort: "size" })).toBe(true);
    expect(needsSizes({ ...DEFAULT_VIEW, size: "small" })).toBe(true);
    expect(sizeText(null)).toBeNull();
    expect(sizeText(512)).toBe("512 B");
    expect(sizeText(1536)).toBe("1.5 KB");
    expect(sizeText(900 * 1024 * 1024)).toBe("900 MB");
  });
});

describe("T-149 cleanup removes children before their parents", () => {
  const parents: Record<string, string> = { "/w/child": "/w/parent", "/w/grand": "/w/child", "/w/other": "/w/parent" };
  const parentOf = (p: string) => parents[p];

  it("puts every child ahead of its parent, deepest first, and keeps the scan order among equals", () => {
    expect(childrenFirst(["/w/parent", "/w/child", "/w/grand", "/w/loner"], parentOf)).toEqual(["/w/grand", "/w/child", "/w/parent", "/w/loner"]);
    expect(childrenFirst(["/w/parent", "/w/other", "/w/child"], parentOf)).toEqual(["/w/other", "/w/child", "/w/parent"]);
  });
  it("counts a parent that is not itself ticked, matches paths across slash and case, and survives a loop", () => {
    const parentsByKey: Record<string, string> = { "/w/child": "/w/parent", "/w/grand": "/W/Child/" };
    expect(childrenFirst(["/w/child", "/W/Grand"], (p) => parentsByKey[p.toLowerCase().replace(/\/+$/, "")])).toEqual(["/W/Grand", "/w/child"]);
    expect(childrenFirst(["/a", "/b"], (p) => (p === "/a" ? "/b" : "/a"))).toHaveLength(2);
  });
  it("leaves the order alone without a parent lookup", () => {
    expect(childrenFirst(["/w/parent", "/w/child"])).toEqual(["/w/parent", "/w/child"]);
  });
});
