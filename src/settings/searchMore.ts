// SET-007 (T-246-b): what the settings search adds on top of search.ts. A query can match an agent's launch
// command ("How it starts": command, default arguments, the NAMES of its environment variables, never the
// values, which can hold secrets), and a query that matches only an advanced control brings that control
// into view: its section is shown and its fold is opened. Pure; the pages read `open` to unfold.
import { MAX_SEARCH, searchSettings, type Hits } from "./search";
import type { PageId } from "./pages";

export type LaunchRow = { id: string; name: string; command?: string; args?: string; env?: string };
/** A control tucked in a fold that a search can match on its own. */
export type Advanced = { page: PageId; section: string; control: string; words: string };

/** The folds the settings pages hold today (the data-fold / <details> a search must open). */
export const ADVANCED: Advanced[] = [
  { page: "agents", section: "agents", control: "how-it-starts", words: "how it starts command arguments args environment env variables launch program" },
  { page: "general", section: "proxy", control: "proxy", words: "proxy address host port bypass" },
];

const terms = (raw: string) => (raw.length > MAX_SEARCH ? [] : raw.toLowerCase().split(/\s+/).filter(Boolean));
const has = (text: string, ts: string[]) => {
  const t = text.toLowerCase();
  return ts.length > 0 && ts.every((w) => t.includes(w));
};
/** Variable names only: "TOKEN=abc" contributes "TOKEN". */
const envNames = (env: string) => env.split(/\r?\n/).map((l) => l.split("=")[0].trim()).join(" ");

/** The agents whose launch line holds every term. */
export function searchLaunch(raw: string, rows: readonly LaunchRow[]): string[] {
  const ts = terms(raw);
  return rows.filter((r) => has(`${r.id} ${r.name} ${r.command ?? ""} ${r.args ?? ""} ${envNames(r.env ?? "")}`, ts)).map((r) => r.id);
}

export type MoreHits = Hits & { /** agents whose "How it starts" fold opens */ launch: Set<string>; /** controls (folds) to open */ open: Set<string> };

/** search.ts's hits plus launch-command and advanced-control matches. Null when nothing is searched. */
export function searchAll(raw: string, rows: readonly LaunchRow[], advanced: readonly Advanced[] = ADVANCED): MoreHits | null {
  const base = searchSettings(raw);
  if (base === null) return null;
  if (base.refused) return { ...base, launch: new Set(), open: new Set() };
  const ts = terms(raw);
  const launch = new Set(searchLaunch(raw, rows));
  const open = new Set<string>();
  const pages: Hits["pages"] = base.pages.map((p) => ({ ...p, sections: p.sections === "all" ? ("all" as const) : [...p.sections] }));
  const add = (page: PageId, section: string) => {
    const found = pages.find((p) => p.page === page);
    if (!found) pages.push({ page, sections: [section] });
    else if (found.sections !== "all" && !found.sections.includes(section)) found.sections.push(section);
  };
  for (const a of advanced) {
    if (!has(a.words, ts)) continue;
    add(a.page, a.section);
    open.add(a.control);
  }
  if (launch.size > 0) {
    add("agents", "agents");
    open.add("how-it-starts");
  }
  return { ...base, pages, launch, open };
}
