import { describe, expect, it } from "vitest";
import type { SpaceRow } from "../projects/space";
import { activeOf, afterBatch, plan, question, stateOf } from "./view";

const row = (path: string, o: Partial<SpaceRow> = {}): SpaceRow => ({ path, branch: null, isMain: false, size: { bytes: 1024, files: 3, incomplete: false }, modified: 0, reclaimable: true, ...o });
const clean = { changes: [], locked: null, nested: [], stamp: "abc|" };

describe("view-014 space page", () => {
  it("states: main, in use, deletable, kept", () => {
    const active = new Set(["C:/w/b"]);
    expect(stateOf(row("C:/w/a", { isMain: true }), active)).toBe("Main");
    expect(stateOf(row("C:/w/b"), active)).toBe("In use");
    expect(stateOf(row("C:/w/c"), active)).toBe("Deletable");
    expect(stateOf(row("C:/w/d", { reclaimable: false }), active)).toBe("Kept");
  });

  it("a pane open anywhere in a worktree marks it active, slash and case blind", () => {
    expect([...activeOf([row("C:/w/a"), row("C:/w/b")], ["c:\\w\\A", "D:/elsewhere"])]).toEqual(["C:/w/a"]);
  });

  it("plan: clean rows become picks with the stamp; changes, locks, nested worktrees and failed checks are skipped", () => {
    const rows = [row("C:/w/a"), row("C:/w/b"), row("C:/w/c"), row("C:/w/d"), row("C:/w/e")];
    const { picks, skipped } = plan(rows, {
      "C:/w/a": clean,
      "C:/w/b": { ...clean, changes: [" M x.ts"] },
      "C:/w/c": { ...clean, locked: "" },
      "C:/w/d": "git is not installed",
    });
    expect(picks).toEqual([{ path: "C:/w/a", stamp: "abc|" }]);
    expect(skipped.map((s) => s.path)).toEqual(["C:/w/b", "C:/w/c", "C:/w/d", "C:/w/e"]);
    expect(skipped[0].why).toBe("It has 1 uncommitted change");
    expect(skipped[1].why).toContain("locked");
    expect(skipped[2].why).toBe("git is not installed");
    expect(skipped[3].why).toBe("The check did not run");
  });

  it("question: names one worktree, counts several, lists the skipped, null when nothing goes", () => {
    const rows = [row("C:/w/feat", { branch: "feat", size: { bytes: 2 * 1024 * 1024, files: 1, incomplete: false } }), row("C:/w/b")];
    const one = question(rows, [{ path: "C:/w/feat", stamp: "s" }], [{ path: "C:/w/b", why: "It is in use" }]);
    expect(one?.title).toBe("Delete the worktree feat?");
    expect(one?.confirm).toBe("Delete");
    expect(one?.lines[0]).toMatch(/^2 MB comes back/);
    expect(one?.lines[1]).toBe("Skipped b: It is in use");
    const two = question(rows, [{ path: "C:/w/feat", stamp: "s" }, { path: "C:/w/b", stamp: "t" }], []);
    expect(two?.title).toBe("Delete 2 worktrees?");
    expect(two?.confirm).toBe("Delete 2");
    expect(question(rows, [], [{ path: "C:/w/b", why: "x" }])).toBeNull();
  });

  it("afterBatch drops the removed rows and keeps the others with their messages", () => {
    const rows = [row("C:/w/a"), row("C:/w/b"), row("C:/w/c")];
    const out = afterBatch(rows, { summary: "1 removed, 1 failed", items: [{ path: "C:/w/a", outcome: "removed", message: null }, { path: "C:/w/b", outcome: "failed", message: "folder is open in another program" }] });
    expect(out.rows.map((r) => r.path)).toEqual(["C:/w/b", "C:/w/c"]);
    expect(out.note).toBe("1 removed, 1 failed · b: folder is open in another program");
  });
});
