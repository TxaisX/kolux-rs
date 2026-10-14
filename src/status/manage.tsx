// VIEW-099 rest (T-153-e): Manage Sessions in the Resource Manager. It ends, in one go, the terminal
// sessions this app runs that no pane shows (left by a window reload, or started from the command line
// with no pane), after one question. Agent sessions (the session tab inventory credits an agent to the
// program Kolux started) are never offered: ending one would throw away an agent's work. Until the
// window has finished loading its workspaces nothing is offered and no session is labelled as in a pane
// or out of one, because the panes have not claimed their sessions yet.
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

/** The sessions Manage Sessions offers to end: shells no pane shows. A session the inventory does not
 * list, or any session when the inventory could not be read (null), is left alone; so is every
 * session while the window is still loading. */
export function cleanupCandidates(sessions: SessionUsage[], tabs: InventoryTab[] | null, names: Record<number, string>, loaded: boolean): SessionUsage[] {
  if (!loaded || tabs === null) return [];
  const shell = new Set(tabs.filter((t) => t.agent === null).map((t) => t.handle));
  return sessions.filter((s) => !(s.id in names) && shell.has(handleOf(s.id))).sort((a, b) => a.id - b.id);
}

const plural = (n: number) => `${n} session${n === 1 ? "" : "s"}`;

type Props = { loaded: boolean; candidates: SessionUsage[]; asking: boolean; onAsk: () => void; onEnd: () => void; onKeep: () => void };

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
        Every session is in a pane or belongs to an agent.
      </div>
    );
  }
  const what = plural(candidates.length);
  if (asking) {
    return (
      <div className="res-ask res-manage" role="alertdialog" aria-label={`End ${what}`} data-manage="ask">
        <span>
          End <b>{what}</b> no pane shows ({candidates.map((c) => `Session ${c.id}`).join(", ")})? Their programs stop. Agent sessions are left alone.
        </span>
        <span className="btn-row">
          <button className="btn danger" onClick={onEnd}>
            {`End ${what}`}
          </button>
          <button className="btn" data-focus="keep" autoFocus onClick={onKeep}>
            Keep
          </button>
        </span>
      </div>
    );
  }
  return (
    <div className="res-row res-manage" data-manage="offer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
      <span className="menu-hint">{what} no pane shows</span>
      <button className="btn" onClick={onAsk} title={`End the ${what} no pane shows; agent sessions are left alone`}>
        {`End ${candidates.length}`}
      </button>
    </div>
  );
}
