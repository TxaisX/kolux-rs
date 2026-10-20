// SET-007 (T-246-d): what Settings and the Agents page use for a search. The hits are searchAll's: the
// pages and sections of search.ts plus agents whose launch line holds the words and advanced controls
// that match on their own; `folds` is what every fold-aware card reads (the Appearance folds and the
// Agents "How it starts" fold open when their id is in it).
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { searchAll, type LaunchRow, type MoreHits } from "./searchMore";

const OPTIONS_FIELD = "agentOptions";

/** One launch row per agent: its name and the command, arguments and environment saved for it. */
export function launchRowsOf(agents: ReadonlyArray<{ id: string; name: string }>, settings: Record<string, unknown>): LaunchRow[] {
  const all = (settings[OPTIONS_FIELD] ?? {}) as Record<string, { command?: unknown; args?: unknown; env?: unknown } | undefined>;
  const text = (v: unknown) => (typeof v === "string" ? v : undefined);
  return agents.map((a) => {
    const o = all[a.id] ?? {};
    return { id: a.id, name: a.name, command: text(o.command), args: text(o.args), env: text(o.env) };
  });
}

/** The ids a fold-aware card looks for: the Appearance folds plus the advanced controls to open. */
export const foldsOf = (hits: MoreHits): Set<string> => new Set([...hits.folds, ...hits.open]);

export function useSearchHits(query: string): { hits: MoreHits | null; folds: Set<string> } {
  const [rows, setRows] = useState<LaunchRow[]>([]);
  const searching = query.trim() !== "";
  // The launch lines are read once, when the first search starts; a failed read just searches without them.
  useEffect(() => {
    if (!searching) return;
    let alive = true;
    void Promise.all([invoke<Record<string, unknown>>("get_settings"), invoke<Array<{ id: string; name: string }>>("agent_list")])
      .then(([settings, agents]) => alive && setRows(launchRowsOf(agents, settings)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [searching]);
  const hits = useMemo(() => searchAll(query, rows), [query, rows]);
  const folds = useMemo(() => (hits ? foldsOf(hits) : new Set<string>()), [hits]);
  return { hits, folds };
}
