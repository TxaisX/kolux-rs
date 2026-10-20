// PROJ-016 header order and PROJ-049 manual workspace order.
import { expect, test } from "vitest";
import { dragStart, dropBefore, dropOutcome, edgeScroll, idsFrom, inSavedOrder, manualOrder, moveHeader, moveRows, siblingIds } from "./order";
import { groupTree, type Groups } from "./groups";

const p = (id: string, name = id) => ({ id, name, path: `C:/${id}` });
const G: Groups = { rev: 1, groups: [{ id: "g1", name: "Work", parent: null }, { id: "g2", name: "Other", parent: null }], members: { A: "g1", B: "g1", C: "g1", D: "g2" } };
const names = (ns: ReturnType<typeof groupTree>): string => ns.map((n) => (n.kind === "group" ? `G:${n.group.id}[${names(n.children)}]` : n.project.id)).join(",");

test("PROJ-016 inside a group holding A, B and C, dragging C above A reads C, A, B and holds after a reload", () => {
  const projects = [p("A"), p("B"), p("C"), p("D"), p("E")];
  const tree = groupTree(G, projects, []);
  const sibs = siblingIds(tree, "C") as string[];
  expect(sibs).toEqual(["A", "B", "C"]);
  const saved = moveHeader([], sibs, "C", "A");
  expect(saved).toEqual(["C", "A", "B"]);
  // the setting is what survives a restart: a fresh tree from the saved list
  expect(names(groupTree(G, projects, idsFrom(JSON.parse(JSON.stringify(saved)))))).toBe("G:g2[D],G:g1[C,A,B],E");
});

test("PROJ-016 a header only ever lands among its own siblings", () => {
  const tree = groupTree(G, [p("A"), p("B"), p("C"), p("D")], []);
  const sibs = siblingIds(tree, "A") as string[];
  expect(dropBefore(sibs, "A", "D", true)).toBeUndefined(); // D is in another group
  expect(moveHeader(["x"], sibs, "A", "D")).toEqual(["x"]);
  expect(moveHeader(["x"], sibs, "D", "A")).toEqual(["x"]);
  expect(dropBefore(sibs, "A", "A", true)).toBeUndefined();
  expect(siblingIds(tree, "nope")).toBeNull();
});

test("PROJ-016 the closest slot: upper half goes before the target, lower half after it, last one goes to the end", () => {
  expect(dropBefore(["A", "B", "C"], "C", "A", true)).toBe("A");
  expect(dropBefore(["A", "B", "C"], "A", "B", false)).toBe("C");
  expect(dropBefore(["A", "B", "C"], "A", "C", false)).toBeNull();
  expect(moveHeader([], ["A", "B", "C"], "A", null)).toEqual(["B", "C", "A"]);
});

test("PROJ-016 headers with no saved position come last, groups before projects, sorted by name", () => {
  const projects = [p("z", "zeta"), p("m", "mu"), p("a", "alpha")];
  const g: Groups = { rev: 1, groups: [{ id: "g", name: "Grp", parent: null }], members: {} };
  expect(names(groupTree(g, projects, ["z"]))).toBe("z,G:g[],a,m");
  expect(inSavedOrder(["b", "a", "c"], (x) => x, ["c"], (x) => x)).toEqual(["c", "a", "b"]);
});

test("PROJ-049 the first drag starts from what is on screen, and the moved row sticks after a reload", () => {
  const screen = ["a", "b", "c", "d", "e"];
  const start = dragStart("smart", [], screen);
  expect(start).toEqual(screen);
  const saved = moveRows(start, ["e"], "a");
  expect(saved).toEqual(["e", "a", "b", "c", "d"]);
  expect(manualOrder(screen, (k) => k, JSON.parse(JSON.stringify(saved)))).toEqual(saved);
});

test("PROJ-049 in Manual order a drag starts from the saved order; rows the order does not know keep their place after it", () => {
  expect(dragStart("manual", ["c", "a"], ["a", "b", "c"])).toEqual(["c", "a", "b"]);
  expect(manualOrder(["a", "n1", "b", "n2"], (k) => k, ["b", "a"])).toEqual(["b", "a", "n1", "n2"]);
});

test("PROJ-049 several selected rows move together and keep their order; a drop on a moved row does nothing", () => {
  expect(moveRows(["a", "b", "c", "d", "e"], ["d", "b"], "a")).toEqual(["b", "d", "a", "c", "e"]);
  expect(moveRows(["a", "b", "c"], ["a", "b"], null)).toEqual(["c", "a", "b"]);
  expect(moveRows(["a", "b", "c"], ["a", "b"], "b")).toEqual(["a", "b", "c"]);
  expect(moveRows(["a", "b"], ["zz"], "a")).toEqual(["a", "b"]);
});

test("PROJ-049 grouped by status and not Manual, another lane changes only the status; within a lane the order is saved", () => {
  expect(dropOutcome("status", "smart", "Working", "Done")).toBe("status");
  expect(dropOutcome("status", "smart", "Done", "Done")).toBe("order");
  expect(dropOutcome("status", "manual", "Working", "Done")).toBe("order");
  expect(dropOutcome("project", "smart", "a", "b")).toBe("order");
});

test("PROJ-049 near the top or bottom edge the list scrolls", () => {
  expect(edgeScroll(105, 100, 500)).toBeLessThan(0);
  expect(edgeScroll(495, 100, 500)).toBeGreaterThan(0);
  expect(edgeScroll(300, 100, 500)).toBe(0);
});
