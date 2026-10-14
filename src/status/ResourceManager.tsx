// APP-054: the Resource Manager, opened from the status bar's memory figure. Memory and CPU for the
// app, for every terminal session grouped under its workspace, and the computer's free memory.
// Ending a session asks first, in the row, and stops that session only; a session a fresh read shows
// has already ended just leaves the list, with no question (VIEW-099). Committed memory (CLI-041)
// sits beside resident in every row, a dash where Windows gave no figure (T-287-b). Manage Sessions
// (VIEW-099 rest, T-153-e) ends the shells no pane shows in one go, never an agent's session, and
// offers nothing while the window is still loading its workspaces. FIX-2: never told that the window
// has loaded means still loading; a shell with a program running in it is not offered; End N ends
// only the sessions its question named.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatMemory } from "./memory";
import { cleanupCandidates, EndQuestion, endConfirmed, ManageSessions, paneless, sessionsLoaded, type InventoryTab } from "./manage";
import { committedNote, endNeedsAsk, formatCommitted, formatCpu, groupSessions, RES_COLUMNS, type Resources, type Row, type SessionUsage, type Usage } from "./resources";

const cols = { gridTemplateColumns: RES_COLUMNS };

/** `loaded` (T-153-e): whether the window has finished loading its workspaces, so its panes have
 * claimed their sessions; until then no row says it is in a pane or out of one. Not given: not loaded. */
type Props = { names: () => Record<number, string>; workspaces: string[]; loaded?: () => boolean; onClose: () => void };

export default function ResourceManager({ names, workspaces, loaded, onClose }: Props) {
  const [data, setData] = useState<Resources | null>(null);
  const [tabs, setTabs] = useState<InventoryTab[] | null>(null);
  const [failed, setFailed] = useState("");
  const [ending, setEnding] = useState<Row | null>(null);
  // TERM-045's close check per paneless shell: true when a program runs in it; null when it failed.
  const [busy, setBusy] = useState<Record<number, boolean> | null>(null);
  // The sessions the open End N question names; End kills only these.
  const [asking, setAsking] = useState<SessionUsage[] | null>(null);
  // The session tab inventory says which sessions run an agent; a failed read offers nothing.
  const readTabs = () =>
    invoke<InventoryTab[]>("session_tabs")
      .then((t) => (Array.isArray(t) ? t : null))
      .catch(() => null)
      .then((t) => {
        setTabs(t);
        return t;
      });
  const read = () =>
    invoke<Resources>("resources")
      .then((r) => {
        setData(r);
        setFailed("");
        return r;
      })
      .catch((e) => {
        setFailed(String(e));
        return null;
      });
  const readBusy = (r: Resources | null, t: InventoryTab[] | null) => {
    const ids = r ? paneless(r.sessions, t, names(), sessionsLoaded(loaded)).map((s) => s.id) : [];
    const asked: Promise<Record<number, boolean> | null> = ids.length === 0
      ? Promise.resolve({})
      : invoke<boolean[]>("terminal_busy", { ids })
          .then((b) => (Array.isArray(b) && b.length === ids.length ? Object.fromEntries(ids.map((id, i) => [id, b[i] !== false])) : null))
          .catch(() => null);
    return asked.then((b) => {
      setBusy(b);
      return b;
    });
  };
  // One fresh read of the sessions, the inventory and the busy check; what Manage Sessions offers now.
  const refresh = async () => {
    const [r, t] = await Promise.all([read(), readTabs()]);
    const b = await readBusy(r, t);
    return r ? cleanupCandidates(r.sessions, t, names(), sessionsLoaded(loaded), b) : [];
  };
  // A fresh read first: when every offered session has already ended, the count updates with no question.
  const askAll = async () => {
    const now = await refresh();
    setAsking(now.length > 0 ? now : null);
  };
  const endAll = async () => {
    const confirmed = (asking ?? []).map((c) => c.id);
    setAsking(null);
    await endConfirmed(confirmed, refresh, (id) => invoke("terminal_kill", { id }).catch((e) => setFailed(String(e))));
    await refresh();
  };
  const ask = async (row: Row) => {
    if (endNeedsAsk(await read(), row.id)) setEnding(row);
  };
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 2000);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", esc);
    };
  }, []);
  const end = async (row: Row) => {
    setEnding(null);
    await invoke("terminal_kill", { id: row.id }).catch((e) => setFailed(String(e)));
    await read();
  };
  const isLoaded = sessionsLoaded(loaded);
  const groups = data ? groupSessions(data.sessions, names(), workspaces, isLoaded) : [];
  const candidates = data ? cleanupCandidates(data.sessions, tabs, names(), isLoaded, busy) : [];

  return (
    <>
      <div className="menu-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="menu res-pop" role="dialog" aria-label="Resource Manager">
        <div className="res-head">
          <span className="menu-title">Resources</span>
          {data && <span className="res-free">{data.free === null ? "Free memory unknown" : `${formatMemory(data.free)} free${data.total === null ? "" : ` of ${formatMemory(data.total)}`}`}</span>}
        </div>
        {failed && <div className="menu-hint warn">{failed}</div>}
        {data && (
          <div className="res-row res-cols" style={cols} aria-hidden="true">
            <span className="res-label">Name</span>
            <span className="res-label res-fig" title="Memory in RAM now (working set)">
              Resident
            </span>
            <span className="res-label res-fig" title="Memory Windows has promised the process (pagefile-backed)">
              Committed
            </span>
            <span className="res-label res-fig">CPU</span>
            <span />
          </div>
        )}
        {data && (
          <div className="res-row res-app" data-row="app" style={cols}>
            <span className="res-name">Kolux</span>
            <span className="res-fig">{formatMemory(data.app.bytes)}</span>
            {committedCell(data.app)}
            <span className="res-fig">{formatCpu(data.app.cpu)}</span>
            <span className="res-end" />
          </div>
        )}
        {data && data.sessions.length === 0 && <div className="menu-hint">No terminal sessions are running.</div>}
        {data && data.sessions.length > 0 && <ManageSessions loaded={isLoaded} candidates={asking ?? candidates} asking={asking !== null} onAsk={() => void askAll()} onEnd={() => void endAll()} onKeep={() => setAsking(null)} />}
        {groups.map((g) => (
          <section key={g.dir ?? ""} className="res-group" aria-label={g.label}>
            <div className="res-label" title={g.dir ?? "Terminals started outside any workspace"}>
              {g.label}
            </div>
            {g.rows.map((r) =>
              ending?.id === r.id ? (
                <EndQuestion key={r.id} name={r.name} shown={r.shown} onEnd={() => void end(r)} onKeep={() => setEnding(null)} />
              ) : (
                <div key={r.id} className="res-row" data-session={r.id} style={cols}>
                  <span className="res-name" title={`${r.processes} process${r.processes === 1 ? "" : "es"}${r.dir ? ` in ${r.dir}` : ""}`}>
                    {r.name}
                    {r.pid !== null && <span className="res-pid"> · pid {r.pid}</span>}
                  </span>
                  <span className="res-fig">{formatMemory(r.bytes)}</span>
                  {committedCell(r)}
                  <span className="res-fig">{formatCpu(r.cpu)}</span>
                  <button className="btn res-end" onClick={() => void ask(r)} title={`End ${r.name}`}>
                    End
                  </button>
                </div>
              ),
            )}
          </section>
        ))}
      </div>
    </>
  );
}

/** MERGE 52 / FIX-1: the committed figure, or a dash with "(n of m could not be read)" under it when some process gave none. */
export function committedCell(u: Usage) {
  const note = committedNote(u);
  return (
    <span className="res-fig" data-fig="committed" title={note ? `${formatCommitted(u.committed)} ${note}` : undefined}>
      {formatCommitted(u.committed)}
      {note && <span className="res-unread" style={{ display: "block", fontSize: "11px", lineHeight: 1.2 }}>{note}</span>}
    </span>
  );
}
