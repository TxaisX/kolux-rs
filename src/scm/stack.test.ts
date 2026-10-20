import { describe, expect, it } from "vitest";
import { chainThrough, mergeThrough, nextInStack, planStackedCreate, stackNote, withStackNote, type StackItem } from "./stack";

const pr = (number: number, head: string, base: string, state = "OPEN"): StackItem => ({ number, head, base, state, url: `https://github.com/o/r/pull/${number}` });
const a = pr(1, "a", "main");
const b = pr(2, "b", "a");
const c = pr(3, "c", "b");
const other = pr(9, "z", "main");

describe("GIT-034 the stack a branch belongs to", () => {
  it("is the chain through the branch, bottom first, whatever the order they are listed in", () => {
    expect(chainThrough([c, other, a, b], "main", "b").items.map((p) => p.number)).toEqual([1, 2, 3]);
    expect(chainThrough([c, a, b], "main", "a").items.map((p) => p.number)).toEqual([1, 2, 3]);
    expect(chainThrough([other], "main", "z").items.map((p) => p.number)).toEqual([9]);
  });
  it("starts where a pull request rests on a branch with no open pull request", () => {
    expect(chainThrough([c], "main", "c").items.map((p) => p.number)).toEqual([3]);
  });
  it("refuses links that do not form one chain", () => {
    const fork = pr(4, "d", "a");
    expect(chainThrough([a, b, fork], "main", "a").error).toMatch(/does not form one chain/);
    expect(chainThrough([a, { ...a, number: 5 }], "main", "a").error).toMatch(/more than one open pull request/);
    expect(chainThrough([pr(1, "a", "b"), pr(2, "b", "a")], "main", "a").error).toMatch(/loop/);
    expect(chainThrough([a], "main", "nope").error).toMatch(/no open pull request/);
  });
  it("names the next pull request up, none at the top", () => {
    expect(nextInStack([a, b, c], 1)?.number).toBe(2);
    expect(nextInStack([a, b, c], 3)).toBeNull();
    expect(nextInStack([a, b, c], 99)).toBeNull();
  });
});

describe("GIT-034 creating the next pull request in a stack", () => {
  it("makes the current branch's pull request first, then the new one, then records the stack", () => {
    expect(planStackedCreate([], "main", "a", "b")).toEqual({ steps: ["create-current", "create-next", "record"], refused: null });
    expect(planStackedCreate([a], "main", "a", "b")).toEqual({ steps: ["create-next", "record"], refused: null });
  });
  it("on a retry never makes a second pull request for a branch that has one", () => {
    expect(planStackedCreate([a, b], "main", "a", "b")).toEqual({ steps: ["record"], refused: null });
  });
  it("creates nothing when the parent links would not form one chain", () => {
    expect(planStackedCreate([a, pr(4, "d", "a")], "main", "a", "c")).toEqual({ steps: [], refused: expect.stringMatching(/one chain/) });
    expect(planStackedCreate([a, pr(2, "b", "main")], "main", "a", "b").refused).toMatch(/resting on main rather than a/);
    expect(planStackedCreate([], "main", "a", "a").refused).toMatch(/branch of its own/);
  });
});

describe("GIT-034 the stack note", () => {
  it("marks this pull request and is replaced, never repeated", () => {
    const note = stackNote([a, b], 2);
    expect(note).toContain("- #1 a");
    expect(note).toContain("- **#2** (this pull request) b");
    const once = withStackNote("Fixes the login.", [a, b], 2);
    expect(once.startsWith("Fixes the login.\n\n")).toBe(true);
    expect(withStackNote(once, [a, b], 2)).toBe(once);
    const grown = withStackNote(once, [a, b, c], 2);
    expect(grown.match(/kolux-stack:start/g)).toHaveLength(1);
    expect(grown).toContain("#3 c");
    expect(withStackNote("", [a], 1)).toBe(stackNote([a], 1) + "\n");
  });
});

describe("GIT-034 merging up to a chosen pull request", () => {
  it("merges the open ones from the bottom up to it, after a confirmation that names them", () => {
    expect(mergeThrough([a, b, c], 2, {})).toEqual({ order: [1, 2], refused: null, confirm: "Merge #1, #2 in this order?" });
    expect(mergeThrough([a, b, c], 1, {}).confirm).toBe("Merge #1?");
    expect(mergeThrough([{ ...a, state: "MERGED" }, b, c], 3, {}).order).toEqual([2, 3]);
  });
  it("is refused when a lower pull request cannot merge", () => {
    const plan = mergeThrough([a, b, c], 3, { 1: "Conflicts" });
    expect(plan.order).toEqual([]);
    expect(plan.refused).toBe("#1 cannot merge yet (Conflicts), so nothing was merged up to #3.");
    expect(mergeThrough([a, b], 2, { 2: "Checks pending" }).refused).toBe("#2 cannot merge yet (Checks pending), so nothing was merged.");
    expect(mergeThrough([a, b], 7, {}).refused).toMatch(/not in this stack/);
  });
});
