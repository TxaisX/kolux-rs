// VIEW-093 (T-127-b): a terminal tab takes the name its agent session was given and follows it when
// it changes. Names are read in the background (session_name); a session with no name yet is asked
// about again soon, then at a slower pace; a name is kept when a read fails or the tab sleeps, and
// dropped only when the tab goes or its session changes. The user's own tab name still wins (App's
// tabName reads sessionNameFor after the custom title and before the program's title).
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type Seat = { key: number; agent: string; session?: string; kind?: string; seats?: unknown[] };
export type Named = { session: string; name: string };

/** Waits between asks for a session that has no name yet; after the last, the slow pace. */
export const RETRY_MS = [4_000, 10_000, 30_000, 60_000];
/** How often every known name is read again to follow a rename. */
export const FOLLOW_MS = 60_000;

/** The wait before the next ask for a session asked about `asked` times already. */
export const retryDelay = (asked: number): number => RETRY_MS[Math.min(asked, RETRY_MS.length - 1)];

/** Only agent panes that report a session can have a session name. */
export const askable = (p: Seat): p is Seat & { session: string } => !p.kind && !p.seats && p.agent !== "shell" && !!p.session;

/** The names that still apply: a tab's name stays while the tab exists with the same session. */
export function keepNames(names: Record<number, Named>, panes: Seat[]): Record<number, Named> {
  const kept: Record<number, Named> = {};
  let same = true;
  for (const [k, n] of Object.entries(names)) {
    const p = panes.find((x) => x.key === Number(k));
    if (p && p.session === n.session) kept[Number(k)] = n;
    else same = false;
  }
  return same ? names : kept;
}

/** The latest names, shared with tabName (a plain lookup, refreshed by the hook's re-render). */
let current: Record<number, Named> = {};
export const sessionNameFor = (key: number): string | undefined => current[key]?.name;

export function useSessionNames(panes: Seat[]): Record<number, string> {
  const [names, setNames] = useState<Record<number, Named>>({});
  const [tick, setTick] = useState(0);
  const asked = useRef<Record<string, number>>({});
  const timers = useRef<Record<number, number>>({});
  const live = useRef(panes);
  live.current = panes;
  current = names;

  const read = (p: Seat & { session: string }) => {
    const id = `${p.key}:${p.session}`;
    invoke<string | null>("session_name", { agent: p.agent, id: p.session })
      .then((name) => {
        if (live.current.find((x) => x.key === p.key)?.session !== p.session) return;
        asked.current[id] = (asked.current[id] ?? 0) + 1;
        if (name) setNames((n) => (n[p.key]?.name === name && n[p.key]?.session === p.session ? n : { ...n, [p.key]: { session: p.session, name } }));
      })
      .catch(() => void (asked.current[id] = (asked.current[id] ?? 0) + 1))
      .finally(() => setTick((t) => t + 1));
  };

  // A tab that is gone, or whose session changed, loses its name; the others keep theirs.
  useEffect(() => {
    setNames((n) => keepNames(n, panes));
  }, [panes]);

  // Each agent pane with a session has one pending ask at a time: at once the first time, soon again
  // while it has no name, and slowly once it has one (to follow a rename).
  const signature = panes.filter(askable).map((p) => `${p.key}:${p.session}`).join("|");
  useEffect(() => {
    const here = live.current.filter(askable);
    for (const [k, t] of Object.entries(timers.current)) {
      if (!here.some((p) => p.key === Number(k))) {
        window.clearTimeout(t);
        delete timers.current[Number(k)];
      }
    }
    for (const p of here) {
      if (timers.current[p.key] !== undefined) continue;
      const count = asked.current[`${p.key}:${p.session}`] ?? 0;
      const named = names[p.key]?.session === p.session;
      const wait = count === 0 ? 0 : named ? FOLLOW_MS : retryDelay(count - 1);
      timers.current[p.key] = window.setTimeout(() => {
        delete timers.current[p.key];
        read(p);
      }, wait);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, tick]);
  useEffect(() => () => Object.values(timers.current).forEach((t) => window.clearTimeout(t)), []);

  return Object.fromEntries(Object.entries(names).map(([k, n]) => [Number(k), n.name]));
}
