// STAT-030 / T-167-b: puts the previous run's status on the panes as they load, unconfirmed, and
// the "restart this terminal" row on a pane whose saved hooks are older than this Kolux. A live
// reading always wins: a pane that already reported is skipped, and its next event clears `stale`.
import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentState } from "../projects/rows";
import type { Crew } from "../terminal/status";
import { restoration, type SavedRow } from "./restored";
import type { TurnInfo } from "./useAgentStatus";

type Deps = {
  panes: { key: number; session?: string }[];
  hookRef: MutableRefObject<Record<number, AgentState>>;
  setHook: Dispatch<SetStateAction<Record<number, AgentState>>>;
  setStale: Dispatch<SetStateAction<Record<number, boolean>>>;
  setCrew: Dispatch<SetStateAction<Record<number, Crew>>>;
  setTurn: Dispatch<SetStateAction<Record<number, TurnInfo>>>;
};

export function useRestoredStatus({ panes, hookRef, setHook, setStale, setCrew, setTurn }: Deps) {
  const [rows, setRows] = useState<SavedRow[]>([]);
  const done = useRef(new Set<number>());
  // T-618: the window's first panes are the ones that came back from the saved layout (App opens with no other); only
  // they wear a saved status, so a tab opened later under a closed tab's number never does. Rust drops the other rows
  // for good; with no pane back (no layout read yet) nothing is dropped.
  const [back] = useState(() => new Map(panes.map((p): [number, string | undefined] => [p.key, p.session])));
  // The saved rows are read once; each waits for its pane to load.
  useEffect(() => {
    const keep = [...back.keys()];
    void invoke<SavedRow[]>("agent_status_saved", keep.length > 0 ? { keep } : {}).then(setRows).catch(() => {});
  }, []);
  useEffect(() => {
    const fresh = rows.filter((r) => !done.current.has(r.paneKey));
    if (fresh.length === 0) return;
    const r = restoration(fresh, new Set(panes.map((p) => p.key)), new Set(Object.keys(hookRef.current).map(Number)), back);
    const keys = Object.keys(r.hook).map(Number);
    if (keys.length === 0) return;
    for (const k of keys) done.current.add(k);
    setHook((h) => ({ ...r.hook, ...h }));
    setStale((s) => ({ ...r.stale, ...s }));
    setCrew((c) => ({ ...r.crew, ...c }));
    setTurn((t) => ({ ...r.turn, ...t }));
  }, [rows, panes]);
}
