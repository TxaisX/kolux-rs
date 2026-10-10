// APP-054: the Resource Manager, opened from the status bar's memory figure. Memory and CPU for the
// app, for every terminal session grouped under its workspace, and the computer's free memory.
// Ending a session asks first, in the row, and stops that session only.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatMemory } from "./memory";
import { formatCpu, groupSessions, type Resources, type Row } from "./resources";

type Props = { names: () => Record<number, string>; workspaces: string[]; onClose: () => void };

export default function ResourceManager({ names, workspaces, onClose }: Props) {
  const [data, setData] = useState<Resources | null>(null);
  const [failed, setFailed] = useState("");
  const [ending, setEnding] = useState<Row | null>(null);
  const read = () =>
    invoke<Resources>("resources")
      .then((r) => {
        setData(r);
        setFailed("");
      })
      .catch((e) => setFailed(String(e)));
  useEffect(() => {
    void read();
    const t = setInterval(read, 2000);
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
  const groups = data ? groupSessions(data.sessions, names(), workspaces) : [];

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
          <div className="res-row res-app" data-row="app">
            <span className="res-name">Kolux</span>
            <span className="res-fig">{formatMemory(data.app.bytes)}</span>
            <span className="res-fig">{formatCpu(data.app.cpu)}</span>
            <span className="res-end" />
          </div>
        )}
        {data && data.sessions.length === 0 && <div className="menu-hint">No terminal sessions are running.</div>}
        {groups.map((g) => (
          <section key={g.dir ?? ""} className="res-group" aria-label={g.label}>
            <div className="res-label" title={g.dir ?? "Terminals started outside any workspace"}>
              {g.label}
            </div>
            {g.rows.map((r) =>
              ending?.id === r.id ? (
                <div key={r.id} className="res-ask" role="alertdialog" aria-label={`End ${r.name}`}>
                  <span>
                    End <b>{r.name}</b>? Its programs stop{r.shown ? " and its pane shows the session as ended" : ""}.
                  </span>
                  <span className="btn-row">
                    <button className="btn danger" onClick={() => void end(r)} autoFocus>
                      End session
                    </button>
                    <button className="btn" onClick={() => setEnding(null)}>
                      Keep
                    </button>
                  </span>
                </div>
              ) : (
                <div key={r.id} className="res-row" data-session={r.id}>
                  <span className="res-name" title={`${r.processes} process${r.processes === 1 ? "" : "es"}${r.dir ? ` in ${r.dir}` : ""}`}>
                    {r.name}
                  </span>
                  <span className="res-fig">{formatMemory(r.bytes)}</span>
                  <span className="res-fig">{formatCpu(r.cpu)}</span>
                  <button className="btn res-end" onClick={() => setEnding(r)} title={`End ${r.name}`}>
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
