import { describe, expect, it } from "vitest";
import { chosenTab, cycleTab, openSwitcher, stepSwitcher, switchOrderOf, tabByNumber, typeOf, type TabInfo } from "./tabCycle";

const T = (key: number, kind?: string): TabInfo => ({ key, ...(kind ? { kind } : {}) });
// terminal 1, browser 2, terminal 3, editor 4, terminal 5
const strip = [T(1), T(2, "browser"), T(3), T(4, "editor"), T(5)];

describe("TERM-051 cycling", () => {
  it("next of the same type skips browser tabs", () => {
    expect(cycleTab(strip, 1, 1, "same")).toBe(3);
    expect(cycleTab(strip, 3, 1, "same")).toBe(5);
    expect(cycleTab(strip, 5, 1, "same")).toBe(1); // wraps
    expect(cycleTab(strip, 1, -1, "same")).toBe(5);
  });
  it("any type walks the strip, terminals only skips the rest", () => {
    expect(cycleTab(strip, 1, 1, "all")).toBe(2);
    expect(cycleTab(strip, 2, 1, "terminals")).toBe(3);
    expect(cycleTab(strip, 2, -1, "terminals")).toBe(1);
    expect(cycleTab(strip, 4, 1, "same")).toBeNull(); // the only editor
  });
  it("follows the strip's order after a drag reorder", () => {
    const dragged = [T(3), T(1), T(5), T(2, "browser"), T(4, "editor")];
    expect(cycleTab(dragged, 3, 1, "all")).toBe(1);
    expect(cycleTab(dragged, 1, 1, "same")).toBe(5);
  });
  it("skips tabs whose content is gone and handles an empty or lone strip", () => {
    expect(cycleTab(strip, 1, 1, "same", new Set([3]))).toBe(5);
    expect(cycleTab(strip, 1, 1, "all", new Set([2, 3, 4, 5]))).toBeNull();
    expect(cycleTab([], 1, 1, "all")).toBeNull();
    expect(cycleTab([T(1)], 1, 1, "all")).toBeNull();
  });
  it("a focus outside the strip enters at its ends", () => {
    expect(cycleTab(strip, 99, 1, "all")).toBe(1);
    expect(cycleTab(strip, 99, -1, "all")).toBe(5);
  });
  it("names the type of a chooser", () => {
    expect(typeOf({ key: 1, seats: [] })).toBe("chooser");
    expect(typeOf(T(2, "diff"))).toBe("diff");
  });
});

describe("TERM-052 go to a tab by number", () => {
  it("picks the position in the visible order", () => {
    expect(tabByNumber(strip, 1)).toBe(1);
    expect(tabByNumber(strip, 4)).toBe(4);
    expect(tabByNumber(strip, 6)).toBeNull();
    expect(tabByNumber(strip, 0)).toBeNull();
    expect(tabByNumber(strip, 2, new Set([2]))).toBe(3);
  });
});

describe("TERM-050 the recent-tab switcher", () => {
  const keys = [1, 2, 3];
  it("one press from C opens the tab used just before", () => {
    const s = openSwitcher(keys, [3, 1, 2], 3, "recent") as ReturnType<typeof openSwitcher> & object;
    expect(s.list).toEqual([3, 1, 2]);
    expect(chosenTab(s)).toBe(1);
    expect(chosenTab(stepSwitcher(s, 1))).toBe(2);
    expect(chosenTab(stepSwitcher(stepSwitcher(s, 1), 1))).toBe(3); // wraps back to the start
    expect(chosenTab(stepSwitcher(s, -1))).toBe(3);
  });
  it("tabs never used sit after the used ones, and closed ones are left out", () => {
    const s = openSwitcher([1, 2, 3, 4], [3, 9, 2], 3, "recent") as { list: number[]; at: number };
    expect(s.list).toEqual([3, 2, 1, 4]);
  });
  it("left-to-right order moves to the tab on the right", () => {
    const s = openSwitcher(keys, [3, 1, 2], 1, "order") as { list: number[]; at: number };
    expect(chosenTab(s)).toBe(2);
    expect(chosenTab(openSwitcher(keys, [], 3, "order") as { list: number[]; at: number })).toBe(1); // wraps
  });
  it("is off with fewer than two live tabs", () => {
    expect(openSwitcher([1], [1], 1, "recent")).toBeNull();
    expect(openSwitcher([1, 2], [1, 2], 1, "recent", new Set([2]))).toBeNull();
    expect(openSwitcher([1, 2], [], 7, "recent")).toBeNull();
  });
  it("reads the order setting", () => {
    expect(switchOrderOf({})).toBe("recent");
    expect(switchOrderOf({ tabSwitchOrder: "order" })).toBe("order");
    expect(switchOrderOf({ tabSwitchOrder: "sideways" })).toBe("recent");
  });
});
