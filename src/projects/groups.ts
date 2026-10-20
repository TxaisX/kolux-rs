// PROJ-014: project groups in the sidebar. The backend keeps them (groups.rs); this builds the
// tree the sidebar draws: groups first, each holding its sub-groups then its projects, and the
// projects in no group after them. Empty groups still show.
import type { Project } from "./model";
import { inSavedOrder } from "./order";

export type Group = { id: string; name: string; parent: string | null };
export type Groups = { groups: Group[]; members: Record<string, string>; rev: number };
export type Node = { kind: "group"; group: Group; children: Node[]; count: number } | { kind: "project"; project: Project };

export const NO_GROUPS: Groups = { groups: [], members: {}, rev: 0 };

/** PROJ-016: with a saved header order, every level follows it; headers without a place come last, groups before projects, by name. */
export function groupTree(g: Groups, projects: Project[], order?: string[]): Node[] {
  const known = new Set(g.groups.map((x) => x.id));
  const at = (parent: string | null): Node[] => {
    const groups: Node[] = g.groups
      .filter((x) => (parent === null ? x.parent === null || !known.has(x.parent) : x.parent === parent))
      .map((group) => {
        const children = at(group.id);
        const count = children.reduce((n, c) => n + (c.kind === "group" ? c.count : 1), 0);
        return { kind: "group", group, children, count };
      });
    const loose = projects.filter((p) => {
      const home = g.members[p.id];
      return parent === null ? !home || !known.has(home) : home === parent;
    });
    const all = [...groups, ...loose.map((project): Node => ({ kind: "project", project }))];
    return order ? inSavedOrder(all, (n) => (n.kind === "group" ? n.group.id : n.project.id), order, (n) => (n.kind === "group" ? n.group.name : n.project.name), (n) => (n.kind === "group" ? 0 : 1)) : all;
  };
  return at(null);
}

/** Two answers can cross (a refresh and a create); the one with the higher count wins. */
export const keepNewer = (old: Groups, next: Groups): Groups => (next.rev > old.rev ? next : old);

/** Where group `id` may move: any group but itself and its own sub-groups (`null`: all). */
export function groupChoices(g: Groups, id: string | null): Group[] {
  const below = new Set(id ? [id] : []);
  for (let grew = true; grew; ) {
    grew = false;
    for (const x of g.groups) if (x.parent && below.has(x.parent) && !below.has(x.id)) grew = !!below.add(x.id);
  }
  return g.groups.filter((x) => !below.has(x.id));
}
