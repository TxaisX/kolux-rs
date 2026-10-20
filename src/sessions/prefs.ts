// VIEW-082 / VIEW-080 (T-168): the session list's view options and its scope, kept in settings so
// they survive a restart and every window sees the same.
import type { GroupBy, SortBy } from "./model";

export const VIEW_KEY = "sessionListView";
export const SCOPE_KEY = "sessionListScope";

/** `depth` null is Unlimited (VIEW-082). Empty sessions are shown by default. */
export type ViewPrefs = { sort: SortBy; group: GroupBy; hiddenAgents: string[]; depth: number | null; hideEmpty: boolean };
export const DEFAULT_VIEW: ViewPrefs = { sort: "recent", group: "none", hiddenAgents: [], depth: 200, hideEmpty: false };
export const DEPTHS: (number | null)[] = [50, 100, 200, 500, null];

const SORTS: SortBy[] = ["recent", "oldest", "title"];
const GROUPS: GroupBy[] = ["none", "folder", "agent", "project"];

/** A saved value that is not a valid option falls back to the default for that option alone. */
export function readView(saved: unknown): ViewPrefs {
  const o = typeof saved === "object" && saved !== null ? (saved as Record<string, unknown>) : {};
  const depth = o.depth === null ? null : typeof o.depth === "number" && Number.isFinite(o.depth) && o.depth > 0 ? Math.floor(o.depth) : DEFAULT_VIEW.depth;
  return {
    sort: SORTS.includes(o.sort as SortBy) ? (o.sort as SortBy) : DEFAULT_VIEW.sort,
    group: GROUPS.includes(o.group as GroupBy) ? (o.group as GroupBy) : DEFAULT_VIEW.group,
    hiddenAgents: Array.isArray(o.hiddenAgents) ? o.hiddenAgents.filter((a): a is string => typeof a === "string") : [],
    depth,
    hideEmpty: o.hideEmpty === true,
  };
}

/** VIEW-082: how many options differ from the defaults (the counter beside Reset). */
export function differing(p: ViewPrefs): number {
  return [p.sort !== DEFAULT_VIEW.sort, p.group !== DEFAULT_VIEW.group, p.hiddenAgents.length > 0, p.depth !== DEFAULT_VIEW.depth, p.hideEmpty !== DEFAULT_VIEW.hideEmpty].filter(Boolean).length;
}

export type Scope = "workspace" | "project" | "all";
/** `manual`: the user chose project or all by hand; it never switches back to workspace on its own. */
export type ScopePref = { scope: Scope; manual: boolean };
export const DEFAULT_SCOPE: ScopePref = { scope: "workspace", manual: false };

export function readScope(saved: unknown): ScopePref {
  const o = typeof saved === "object" && saved !== null ? (saved as Record<string, unknown>) : {};
  const scope = o.scope === "project" || o.scope === "all" || o.scope === "workspace" ? o.scope : "workspace";
  return { scope, manual: o.manual === true && scope !== "workspace" };
}

/** Choosing a scope by hand: project or all is remembered as manual; workspace is the default again. */
export const chooseScope = (scope: Scope): ScopePref => ({ scope, manual: scope !== "workspace" });

/** VIEW-080: what is asked for may be unavailable (no workspace in front, a folder with no project);
 * then the nearest wider scope is shown, and the wish stays so it returns when it is available. */
export function effectiveScope(pref: ScopePref, available: { workspace: boolean; project: boolean }): Scope {
  const order: Scope[] = ["workspace", "project", "all"];
  const ok = (s: Scope) => s === "all" || (s === "workspace" ? available.workspace : available.project);
  return order.slice(order.indexOf(pref.scope)).find(ok) ?? "all";
}
