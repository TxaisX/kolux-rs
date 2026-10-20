import { beforeEach, describe, expect, it } from "vitest";
import { addKept, forgetCleanupMemory, keptAfter, keptBatches, keptView, lastScan, preselected, rememberScan, rememberShowAll, rememberedShowAll, rowFacts, rowLabel, shownRows, tickedPaths, ticksAfterScan, type KeptItem, type Scan, type ScanRow } from "./cleanup";

const row = (path: string, over: Partial<ScanRow> = {}): ScanRow => ({
  path,
  branch: path.split("/").pop() ?? null,
  name: null,
  idleDays: 12,
  changes: 0,
  merged: false,
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
