// T-275 (STAT-031): agents that are gone stop reporting. Three rules, pure and tested on their own,
// then one hook (useGone) that App.tsx mounts beside useAgentEvents:
//   1. a working or waiting row whose program has certainly ended is retired (its hook state is
//      dropped, so the row falls back to "done", and its tool / question / sub-agent lines clear);
//      the pane keeps its resume identity (Pane.session is never touched here);
//   2. once a tab is closed, any late event for it is ignored until Kolux quits; other tabs go on;
//   3. a retired pane returns only when a genuine new turn begins: a fresh start, or a working
//      report while the program is up again. A late Stop or ask from the old process is dropped.
// A pane restarted in place gets a new key (restartPane), so it starts clean by construction.
import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { AgentState } from "../projects/rows";
import type { Crew } from "../terminal/status";
import type { TurnInfo } from "./useAgentStatus";

/** The hook states that claim an agent is alive and busy or asking. */
export const LIVE_STATES: readonly AgentState[] = ["working", "queued", "waiting", "permission", "blocked"];

export type Ledger = { closed: Set<number>; retired: Set<number>; running: Record<number, boolean> };

export const newLedger = (): Ledger => ({ closed: new Set(), retired: new Set(), running: {} });
/** The window's one ledger; it lives until Kolux quits, as the rule says. */
export const ledger: Ledger = newLedger();

type Seat = { key: number; agent: string; kind?: string; seats?: unknown };
const isAgent = (p: Seat) => p.agent !== "shell" && !p.kind && !p.seats;

/** Panes seen before and missing now are closed: their keys go on the ledger for good. Returns the newly closed. */
export function noteClosed(l: Ledger, before: Set<number>, open: Set<number>): number[] {
  const gone = [...before].filter((k) => !open.has(k) && !l.closed.has(k));
  for (const k of gone) {
    l.closed.add(k);
    l.retired.delete(k);
  }
  return gone;
}

/** Agent panes whose hook state still says live while their program has certainly ended (running is exactly false). */
export function deadKeys(panes: Seat[], hook: Record<number, AgentState>, running: Record<number, boolean>): number[] {
  return panes.filter((p) => isAgent(p) && running[p.key] === false && hook[p.key] !== undefined && LIVE_STATES.includes(hook[p.key])).map((p) => p.key);
}

/** The state records without the dead panes' live claims; a record with nothing to change comes back as the same object. */
/** The record without these panes' entries; the same object back when it had none. */
export function forget<T>(keys: number[], r: Record<number, T>): Record<number, T> {
  if (!keys.some((k) => k in r)) return r;
  const kept = { ...r };
  for (const k of keys) delete kept[k];
  return kept;
}

/** The state records without the dead panes' live claims; a record with nothing to change comes back as the same object. */
export function retire(dead: number[], hook: Record<number, AgentState>, turn: Record<number, TurnInfo>, crew: Record<number, Crew>) {
  let quiet = turn;
  if (dead.some((k) => k in turn)) {
    quiet = { ...turn };
    // What the agent was doing clears; how it stopped, its last reply and the file it wrote stay for the Inbox.
    for (const k of dead) if (k in quiet) quiet[k] = { stop: quiet[k].stop, reply: quiet[k].reply, wrote: quiet[k].wrote };
  }
  return { hook: forget(dead, hook), turn: quiet, crew: forget(dead, crew) };
}

/**
 * Whether an agent-status report for `key` may change anything. A closed tab, or a key no pane has,
 * never; a retired pane only on a genuine new turn (and then it is no longer retired).
 */
export function admit(l: Ledger, key: number, open: Set<number>, ev: { state?: string; fresh?: boolean }): boolean {
  if (l.closed.has(key) || !open.has(key)) return false;
  if (!l.retired.has(key)) return true;
  const genuine = ev.fresh === true || (ev.state === "working" && l.running[key] !== false);
  if (genuine) l.retired.delete(key);
  return genuine;
}

type GoneDeps = {
  panes: (Seat & { cwd: string | null })[];
  running: Record<number, boolean>;
  hook: Record<number, AgentState>;
  setHook: Dispatch<SetStateAction<Record<number, AgentState>>>;
  setTurn: Dispatch<SetStateAction<Record<number, TurnInfo>>>;
  setCrew: Dispatch<SetStateAction<Record<number, Crew>>>;
};

export function useGone({ panes, running, hook, setHook, setTurn, setCrew }: GoneDeps) {
  const seen = useRef<Set<number>>(new Set());
  ledger.running = running;
  useEffect(() => {
    // Rule 2: a closed tab's late events are ignored, and what the window kept for it is let go.
    const open = new Set(panes.map((p) => p.key));
    const closed = noteClosed(ledger, seen.current, open);
    seen.current = open;
    if (closed.length === 0) return;
    setHook((m) => forget(closed, m));
    setTurn((m) => forget(closed, m));
    setCrew((m) => forget(closed, m));
  }, [panes]);
  useEffect(() => {
    // Rule 1: a program that has ended retires its live claims.
    const dead = deadKeys(panes, hook, running);
    if (dead.length === 0) return;
    for (const k of dead) ledger.retired.add(k);
    setHook((h) => retire(dead, h, {}, {}).hook);
    setTurn((t) => retire(dead, {}, t, {}).turn);
    setCrew((c) => retire(dead, {}, {}, c).crew);
  }, [panes, hook, running]);
}
