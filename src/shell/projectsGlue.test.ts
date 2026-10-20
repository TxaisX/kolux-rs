import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));
import { afterScroll, dismissedOutside, idsToAsk, jumpToCurrent, OUTSIDE_DISMISSED_SETTING, outsideOf, planRemoval, questionFor, toggleRow, wheelFlick, withDismissed } from "./projectsGlue";
import type { Worktree } from "../projects/model";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const wt = (path: string, kind?: Worktree["kind"]): Worktree => ({ path, branch: "b", head: "h", isMain: false, kind });
const clean = { changes: [], locked: null, nested: [], stamp: "s1" };

describe("PROJ-018 found icons", () => {
  it("asks once per project, and asks again only for projects not asked yet", () => {
    expect(idsToAsk(["a", "b", "c"], new Set(["b"]))).toEqual(["a", "c"]);
  });
});

describe("PROJ-043 outside card", () => {
  it("lists only external worktrees and remembers a dismissal per project", () => {
    expect(outsideOf([wt("a", "managed"), wt("b", "external"), wt("c")]).map((w) => w.path)).toEqual(["b"]);
    const s = { [OUTSIDE_DISMISSED_SETTING]: ["p1", 7] };
    expect(dismissedOutside(s)).toEqual(["p1"]);
    expect(withDismissed(s, "p2")).toEqual(["p1", "p2"]);
    expect(withDismissed(s, "p1")).toEqual(["p1"]);
    expect(dismissedOutside({})).toEqual([]);
  });
});

describe("PROJ-054 scroll to top and jump", () => {
  const long = { scrollTop: 2000, scrollHeight: 5000, clientHeight: 600 };
  it("one wheel tick is not a flick; a fast run upward is", () => {
    const a = wheelFlick(null, -100, 1000);
    expect(a.flick).toBe(false);
    const b = wheelFlick(a.wheel, -300, 1030);
    expect(b.flick).toBe(true);
    expect(wheelFlick(null, 100, 1000).flick).toBe(false); // downward never
    expect(wheelFlick(b.wheel, -100, 5000).wheel).toEqual({ start: 5000, dy: -100 }); // a long pause starts a new flick
  });
  it("shows on a flick for a long, scrolled list, and any scroll while shown restarts the idle clock", () => {
    const shown = afterScroll({ shown: false, idleSince: 0 }, long, true, 100);
    expect(shown).toEqual({ shown: true, idleSince: 100 });
    expect(afterScroll(shown, long, false, 900)).toEqual({ shown: true, idleSince: 900 });
    expect(afterScroll({ shown: false, idleSince: 0 }, long, false, 100).shown).toBe(false);
    expect(afterScroll(shown, { ...long, scrollTop: 0 }, false, 1000).shown).toBe(false);
  });
  it("jump clears filters only when they hide the row, then scrolls to it once drawn", async () => {
    const row = {} as Element;
    let tries = 0;
    const calls: string[] = [];
    const ok = await jumpToCurrent({
      path: "C:/w/x",
      hiddenByFilters: true,
      clear: () => calls.push("clear"),
      find: () => (++tries < 3 ? null : row),
      show: () => calls.push("show"),
      wait: () => Promise.resolve(),
    });
    expect([ok, calls, tries]).toEqual([true, ["clear", "show"], 3]);
    const calls2: string[] = [];
    await jumpToCurrent({ path: "C:/w/x", hiddenByFilters: false, clear: () => calls2.push("clear"), find: () => row, show: () => calls2.push("show") });
    expect(calls2).toEqual(["show"]);
    expect(await jumpToCurrent({ path: null, hiddenByFilters: false, clear: () => {}, find: () => row, show: () => {} })).toBe(false);
  });
});

describe("PROJ-058 multi-select and one confirmation", () => {
  it("the first Ctrl-click adds to the open workspace; another toggles", () => {
    expect(toggleRow([], "B", "A", same)).toEqual(["A", "B"]);
    expect(toggleRow(["A", "B"], "b", "A", same)).toEqual(["A"]);
    expect(toggleRow([], "B", null, same)).toEqual(["B"]);
  });
  it("one question covers all rows; a dirty row goes with force, a locked one stays", () => {
    const items = [
      { path: "p1", name: "one", projectId: "x", check: clean },
      { path: "p2", name: "two", projectId: "y", check: { ...clean, stamp: "s2", changes: ["M a.ts"] } },
      { path: "p3", name: "three", projectId: "x", check: { ...clean, stamp: "s3", locked: "in use" } },
    ];
    const q = questionFor(items);
    expect(q.title).toBe("Remove 2 workspaces?");
    expect(q.blocked.map((b) => b.path)).toEqual(["p3"]);
    expect(planRemoval(q, items)).toEqual([
      { path: "p1", projectId: "x", force: false, stamp: "s1" },
      { path: "p2", projectId: "y", force: true, stamp: "s2" },
    ]);
  });
});
