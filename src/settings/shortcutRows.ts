// SET-008 / SET-010: the Shortcuts page's rows. Each command with its chords as drawn, its area,
// its badges (Modified, Unassigned, Disabled, Conflicts) and, for a clash, a hint on fixing it;
// then the filters and the search. Pure, so it is tested without a browser.
import { defaultsFor, type Platform, type Scope } from "../keys/actions";
import { labelParts, type Keymap } from "../keys/keymap";

export const AREAS: Record<Scope, string> = { global: "General", tabs: "Tabs", terminal: "Terminal", browser: "Browser", editor: "Editor", explorer: "File explorer", settings: "Settings" };
export type Badge = "Modified" | "Unassigned" | "Disabled" | "Conflicts";
export type Filter = "all" | "modified" | "unassigned" | "conflicting";
export const FILTERS: Array<[Filter, string]> = [["all", "All"], ["modified", "Modified"], ["unassigned", "Unassigned"], ["conflicting", "Conflicting"]];
/** A longer search is cut to this, so an enormous paste cannot freeze the list. */
export const MAX_QUERY = 100;

export type Row = { id: string; title: string; area: string; chords: string[]; labels: string[]; modified: boolean; badges: Badge[]; hint?: string; find: string[] };

const compact = (s: string) => s.toLowerCase().replace(/[\s+]/g, "");
const names = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function shortcutRows(map: Keymap): Row[] {
  const p = map.platform;
  const title = (id: string) => map.bindings.get(id)?.action.title ?? id;
  return [...map.bindings.values()].map(({ action, chords, custom }) => {
    const defaults = defaultsFor(action, p);
    const disabled = custom && chords.length === 0 && defaults.length > 0;
    const modified = custom && chords.join() !== defaults.join();
    const clash = map.clashes.find((c) => c.ids.includes(action.id));
    const badges: Badge[] = [];
    if (disabled) badges.push("Disabled");
    else if (chords.length === 0) badges.push("Unassigned");
    else if (modified) badges.push("Modified");
    if (clash) badges.push("Conflicts");
    const label = (c: string, on: Platform = p) => labelParts(c, on).join("+");
    const every = [...chords, ...action.win32, ...(action.darwin ?? [])];
    const find = [action.title, AREAS[action.scope], action.id, ...(action.keywords ?? [])].map((s) => s.toLowerCase());
    const keys = every.flatMap((c) => [c, label(c, "win32"), label(c, "darwin")]).map(compact);
    return {
      id: action.id,
      title: action.title,
      area: AREAS[action.scope],
      chords,
      labels: chords.map((c) => label(c)),
      modified,
      badges,
      hint: clash && `${label(clash.chord)} is also used by ${names(clash.ids.filter((x) => x !== action.id).map(title))} here. Give one of them other keys.`,
      find: [...find, ...keys.map((k) => "\u0000" + k)],
    };
  });
}

/** The rows a filter and a search leave, in table order. Text matches titles, areas, ids and
 *  keywords; a chord matches as written in the file or as drawn, on any platform. */
export function filterRows(rows: Row[], filter: Filter, query: string): Row[] {
  const q = query.slice(0, MAX_QUERY).trim().toLowerCase();
  const k = "\u0000" + compact(q);
  const pass = (r: Row) => (filter === "all" ? true : filter === "modified" ? r.modified : filter === "unassigned" ? r.chords.length === 0 : r.badges.includes("Conflicts"));
  return rows.filter((r) => pass(r) && (!q || r.find.some((f) => (f.startsWith("\u0000") ? f.includes(k.slice(1)) && k.length > 1 : f.includes(q)))));
}
