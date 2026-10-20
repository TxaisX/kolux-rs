// ACCT-063 (T-261): each agent pane has one clear owning session. A session id (the agent's own
// conversation handle, Pane.session) belongs to one pane at a time, so a restart resumes it once and
// status and resume point at the same conversation. Pure; the wiring is the claim call in
// status/useAgentStatus.ts and the dedupe in terminal/layout.ts (evidence/sessions-T-261-*.patch).
// Closed tabs and retired panes ignoring late events is status/gone.ts (T-275); a pane restarted in
// place gets a new key (restartPane), so it starts clean.

type Seat = { key: number; session?: string };

/** A pane reports (or reattaches with) a session id: it owns it from now on. Any other pane that
 * still holds the same id lets go of it, so that conversation is not resumed twice. The same array
 * comes back when nothing changes. */
export function claim<P extends Seat>(panes: P[], key: number, session: string): P[] {
  if (session === "" || !panes.some((p) => p.key === key)) return panes;
  const changes = panes.some((p) => (p.key === key ? p.session !== session : p.session === session));
  if (!changes) return panes;
  return panes.map((p) => {
    if (p.key === key) return { ...p, session };
    if (p.session !== session) return p;
    const { session: _gone, ...rest } = p;
    return rest as P;
  });
}

/** Panes read back from a saved layout: where several carry the same session id, the newest pane
 * (the highest key) keeps it and the others start fresh instead of resuming the same conversation
 * again. Nothing to change gives the same array. */
export function uniqueOwners<P extends Seat>(panes: P[]): P[] {
  const owner = new Map<string, number>();
  for (const p of panes) if (p.session && (owner.get(p.session) ?? -1) < p.key) owner.set(p.session, p.key);
  if (panes.every((p) => !p.session || owner.get(p.session) === p.key)) return panes;
  return panes.map((p) => {
    if (!p.session || owner.get(p.session) === p.key) return p;
    const { session: _gone, ...rest } = p;
    return rest as P;
  });
}

/** What a pane is recorded as when it was started as a fork: the session it came from, while its own
 * session id stays unset until its first report. A fork is never a resume of its source. */
export const forkFields = (source: { session?: string }): { forkOf: string } | Record<string, never> => (source.session ? { forkOf: source.session } : {});

/** What a restart resumes for a pane: its own session id; a fork that has not reported one yet starts fresh. */
export const resumeId = (p: { session?: string; forkOf?: string }): string | null => (p.session && p.session !== p.forkOf ? p.session : null);
