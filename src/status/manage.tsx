// VIEW-099 rest (T-153-e): Manage Sessions in the Resource Manager. It ends, in one go, the terminal
// sessions this app runs that no pane shows (left by a window reload, or started from the command line
// with no pane), after one question. Agent sessions (the session tab inventory credits an agent to the
// program Kolux started) are never offered: ending one would throw away an agent's work. Until the
// window has finished loading its workspaces nothing is offered and no session is labelled as in a pane
// or out of one, because the panes have not claimed their sessions yet.
// FIX-2 (council re-review of b67efb1): a Resource Manager nobody tells about loading counts the window
// as still loading; a shell with a program running in it (an agent typed by hand among them, which the
// inventory credits to no agent) is never offered; End N ends only what the question named.
// ponytail: sessions a background host holds while no window is open wait for that host (TERM-105 is
// not built); that part of the card is T-153-f.
import type { SessionUsage } from "./resources";

/** One row of the session tab inventory (ORCH-060, the `session_tabs` command): the handle and the
 * agent Kolux started in it, none for a shell. */
export type InventoryTab = { handle: string; agent: string | null };

/** The handle the inventory uses for a terminal id. */
export const handleOf = (id: number) => `term-${id}`;

/** What a row is called. Before the window has loaded, no row claims a pane either way. */
export function sessionLabel(id: number, names: Record<number, string>, loaded: boolean): { name: string; shown: boolean } {
  if (!loaded) return { name: `Session ${id}`, shown: false };
  return id in names ? { name: names[id], shown: true } : { name: `Session ${id} (not in a pane)`, shown: false };
}

/** Shells no pane shows: the sessions whose busy state Manage Sessions asks for. A session the
 * inventory does not list, or any session when the inventory could not be read (null), is left
 * alone; so is every session while the window is still loading. */
export function paneless(sessions: SessionUsage[], tabs: InventoryTab[] | null, names: Record<number, string>, loaded: boolean): SessionUsage[] {
  if (!loaded || tabs === null) return [];
  const shell = new Set(tabs.filter((t) => t.agent === null).map((t) => t.handle));
  return sessions.filter((s) => !(s.id in names) && shell.has(handleOf(s.id))).sort((a, b) => a.id - b.id);
}

/** The sessions Manage Sessions offers to end: shells no pane shows with nothing running in them.
 * `busy` is the close check's answer per terminal id (TERM-045: a live program under the shell);
 * a shell not in it, or every shell when the check failed (null), is left alone. */
export function cleanupCandidates(sessions: SessionUsage[], tabs: InventoryTab[] | null, names: Record<number, string>, loaded: boolean, busy: Record<number, boolean> | null): SessionUsage[] {
  if (busy === null) return [];
  return paneless(sessions, tabs, names, loaded).filter((s) => busy[s.id] === false);
}

/** FB-1: whether the Resource Manager may treat the window as loaded. No reading means not loaded. */
export const sessionsLoaded = (loaded?: () => boolean) => (loaded ? loaded() === true : false);

type PaneLike = { key: number; kind?: string };

/** FB-1: the window's `loaded` rule. Loaded once its settings are read and every pane restored at
 * start has its terminal session, or is gone, or is not a terminal; then it stays loaded, so a pane
 * opened later never makes the window "loading" again. One latch per window load. */
export function makeLoadedLatch() {
  let done = false;
  return (settingsRead: boolean, restored: Iterable<number>, ptys: Record<number, number>, panes: PaneLike[]): boolean => {
    if (done) return true;
    if (!settingsRead) return false;
    const waiting = (k: number) => ptys[k] === undefined && panes.some((p) => p.key === k && p.kind === undefined);
    done = ![...restored].some(waiting);
    return done;
  };
}

/** This window's latch: the module loads again with the window, so a reload starts it over. */
export const windowLoaded = makeLoadedLatch();

/** FIX-SOON 1: End N ends the sessions the question named that a fresh read still offers; a session
 * that appeared after the question is not touched, and a failed read ends nothing. */
export async function endConfirmed(confirmed: number[], fresh: () => Promise<SessionUsage[]>, kill: (id: number) => Promise<unknown>): Promise<number[]> {
  const now = await fresh().then((list) => new Set(list.map((s) => s.id)), () => new Set<number>());
  const ids = confirmed.filter((id) => now.has(id));
  for (const id of ids) await kill(id);
  return ids;
}

const plural = (n: number) => `${n} session${n === 1 ? "" : "s"}`;

type Props = { loaded: boolean; candidates: SessionUsage[]; asking: boolean; onAsk: () => void; onEnd: () => void; onKeep: () => void };

/** One session's End question, in its row; Keep holds focus so a stray Enter ends nothing (VIEW-116). */
export function EndQuestion({ name, shown, onEnd, onKeep }: { name: string; shown: boolean; onEnd: () => void; onKeep: () => void }) {
  return (
    <div className="res-ask" role="alertdialog" aria-label={`End ${name}`}>
      <span>
        End <b>{name}</b>? Its programs stop{shown ? " and its pane shows the session as ended" : ""}.
      </span>
      <span className="btn-row">
        <button className="btn danger" onClick={onEnd}>
          End session
        </button>
        <button className="btn" autoFocus onClick={onKeep}>
          Keep
        </button>
      </span>
    </div>
  );
}

/** The Manage Sessions section: a count, End N, and an in-row question with Keep focused. */
export function ManageSessions({ loaded, candidates, asking, onAsk, onEnd, onKeep }: Props) {
  if (!loaded) {
    return (
      <div className="menu-hint res-manage" data-manage="loading">
        Manage sessions: the window is still loading its workspaces.
      </div>
    );
  }
  if (candidates.length === 0) {
    return (
      <div className="menu-hint res-manage" data-manage="none">
        Every session is in a pane, belongs to an agent, or has a program running.
      </div>
    );
  }
  const what = plural(candidates.length);
  if (asking) {
    return (
      <div className="res-ask res-manage" role="alertdialog" aria-label={`End ${what}`} data-manage="ask">
        <span>
          End <b>{what}</b> no pane shows ({candidates.map((c) => `Session ${c.id}`).join(", ")})? Their shells close. Agent sessions, and shells with a program running (an agent typed by hand among them), are left alone.
        </span>
        <span className="btn-row">
          <button className="btn danger" onClick={onEnd}>
            {`End ${what}`}
          </button>
          <button className="btn" autoFocus onClick={onKeep}>
            Keep
          </button>
        </span>
      </div>
    );
  }
  return (
    <div className="res-row res-manage" data-manage="offer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
      <span className="menu-hint">{what} no pane shows</span>
      <button className="btn" onClick={onAsk} title={`End the ${what} no pane shows; agent sessions and shells with a program running are left alone`}>
        {`End ${candidates.length}`}
      </button>
    </div>
  );
}
