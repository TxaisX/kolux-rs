// PROJ-014: the sidebar's tree of project groups, and keeping the newer answer.
import { expect, test } from "vitest";
import { groupTree, keepNewer, groupChoices, type Groups } from "./groups";

const p = (id: string) => ({ id, name: id, path: `C:/${id}` });
const G: Groups = {
  rev: 3,
  groups: [
    { id: "a", name: "Work", parent: null },
    { id: "b", name: "Clients", parent: "a" },
    { id: "e", name: "Empty", parent: null },
  ],
  members: { p2: "a", p3: "b", ghost: "a", p4: "gone" },
};

test("groups come first with their sub-groups and projects inside; empty groups still show", () => {
  const tree = groupTree(G, [p("p1"), p("p2"), p("p3"), p("p4")]);
  expect(tree.map((n) => (n.kind === "group" ? `G:${n.group.name}:${n.count}` : `P:${n.project.id}`))).toEqual(["G:Work:2", "G:Empty:0", "P:p1", "P:p4"]);
  const work = tree[0];
  if (work.kind !== "group") throw new Error("group");
  expect(work.children.map((n) => (n.kind === "group" ? `G:${n.group.name}:${n.count}` : `P:${n.project.id}`))).toEqual(["G:Clients:1", "P:p2"]);
});

test("a group whose parent is gone shows at the top level", () => {
  const tree = groupTree({ rev: 1, groups: [{ id: "x", name: "Orphan", parent: "gone" }], members: {} }, []);
  expect(tree).toHaveLength(1);
});

test("an older answer never replaces a newer one", () => {
  const older = { ...G, rev: 2, groups: [] };
  expect(keepNewer(G, older)).toBe(G);
  const newer = { ...G, rev: 4 };
  expect(keepNewer(G, newer)).toBe(newer);
});

test("a group can move anywhere but inside itself or its own sub-groups", () => {
  expect(groupChoices(G, "a").map((g) => g.id)).toEqual(["e"]);
  expect(groupChoices(G, "b").map((g) => g.id)).toEqual(["a", "e"]);
  expect(groupChoices(G, null).map((g) => g.id)).toEqual(["a", "b", "e"]);
});
