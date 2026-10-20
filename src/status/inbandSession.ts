// STAT-034 (rest, T-124-b): an in-band status (OSC 9999) and the pane's stored provider session
// (Pane.session, the agent's own conversation id a restart resumes; only hooks set it, through
// sessions/ownership.ts claim). An in-band completion (or any state but working) keeps it; an
// in-band new turn (working) drops it, since the turn a script reports in band is not the
// conversation the hooks last named. The terminal pane hands each payload to inbandTurn
// (evidence/hooks-T-124-b-TerminalPane.tsx.patch, core lane); the status listener in
// useAgentStatus.ts drops the session. Pure apart from the one listener registry.

/** The state an OSC 9999 payload names, as Rust's parse_inband reads it: the text after "9999;"
 * is JSON with `state` (or `status`, the field older scripts print); unknown states are null. */
const STATES = ["working", "done", "permission", "waiting", "idle"] as const;
export type InbandState = (typeof STATES)[number];

export function inbandState(data: string): InbandState | null {
  let v: unknown;
  try {
    v = JSON.parse(data.startsWith("9999;") ? data.slice(5) : data);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const s = o.state ?? o.status;
  return STATES.find((x) => x === s) ?? null;
}

/** An in-band new turn drops the stored provider session; a completion or anything else keeps it. */
export const dropsSession = (state: InbandState | null): boolean => state === "working";

type Seat = { key: number; session?: string };

/** The panes with pane `key`'s stored provider session dropped; the same array when it has none. */
export function forgetSession<P extends Seat>(panes: P[], key: number): P[] {
  if (!panes.some((p) => p.key === key && p.session !== undefined)) return panes;
  return panes.map((p) => {
    if (p.key !== key) return p;
    const { session: _gone, ...rest } = p;
    return rest as P;
  });
}

const listeners = new Set<(paneKey: number) => void>();

/** The status listener's subscription: called with the pane key of each in-band new turn. */
export function onInbandTurn(f: (paneKey: number) => void): () => void {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

/** The terminal pane's hand-off: an in-band payload printed in an agent pane. True when it was a new
 * turn, and the listeners were told. */
export function inbandTurn(paneKey: number | undefined, data: string): boolean {
  if (paneKey === undefined || !dropsSession(inbandState(data))) return false;
  for (const f of [...listeners]) f(paneKey);
  return true;
}
