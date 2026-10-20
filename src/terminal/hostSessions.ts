// T-153-f (VIEW-099 rest): Manage Sessions also lists and ends the terminals the background terminal
// service holds that no window owns (left by a window that is gone, or started there with no pane).
// The window lists them through the `terminal_host_sessions` command and ends one through
// `terminal_host_end`. An agent's terminal is never offered, nor one with a program running in it;
// until the window has loaded its workspaces nothing is offered, because the window may still be
// taking its own terminals back from the service.

/** One terminal the service holds that no window owns (the Rust side's HostSession). */
export type HostSession = { id: number; pid: number | null; program: string; dir: string | null; agent: boolean; busy: boolean };

/** The background sessions Manage Sessions may offer to end: none while the window is loading. */
export function offerable(rows: HostSession[] | null, loaded: boolean): HostSession[] {
  if (!loaded || rows === null) return [];
  return rows.filter((r) => !r.agent && !r.busy).sort((a, b) => a.id - b.id);
}

const base = (p: string) => p.replace(/^"|"$/g, "").split(/\s+(?=-)/)[0].split(/[\\/]/).pop() || p;

/** What a background session is called in the list and the question. */
export function hostLabel(h: HostSession): string {
  const what = h.program ? ` (${base(h.program)})` : "";
  return `Background session ${h.id}${what}`;
}

const plural = (n: number) => `${n} background session${n === 1 ? "" : "s"}`;

/** The line under Manage Sessions: how many the service holds that no window owns, and why some are left alone. */
export function hostSummary(rows: HostSession[] | null, loaded: boolean): string | null {
  if (!loaded || rows === null || rows.length === 0) return null;
  const offered = offerable(rows, loaded).length;
  const kept = rows.length - offered;
  if (offered === 0) return `${plural(rows.length)} no window owns: agent sessions or with a program running, left alone.`;
  return `${plural(offered)} no window owns${kept > 0 ? ` (${kept} more left alone: agent or busy)` : ""}`;
}

/** End N: ends the sessions the question named that a fresh read still offers; one that has already
 * ended is skipped with no question, one that appeared after the question is not touched, and a
 * failed read ends nothing. Returns the ids the service really ended. */
export async function endOffered(confirmed: number[], fresh: () => Promise<HostSession[]>, end: (id: number) => Promise<boolean>): Promise<number[]> {
  const now = await fresh().then(
    (rows) => new Set(offerable(rows, true).map((r) => r.id)),
    () => new Set<number>(),
  );
  const ended: number[] = [];
  for (const id of confirmed.filter((i) => now.has(i))) {
    if (await end(id).catch(() => false)) ended.push(id);
  }
  return ended;
}

export const hostPlural = plural;
