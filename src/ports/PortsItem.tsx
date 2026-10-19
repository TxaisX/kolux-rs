// VIEW-078: the ports item in the status bar. The number is the ports the workspaces are listening
// on; the popover lists each with the address its dev server printed, an Open button (the Kolux
// browser; Shift+Ctrl-click opens the system browser) and a Stop button. Ports held by programs
// outside the workspaces are listed as external and have no Stop button.
import { useRef, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openInBrowser } from "../browser/BrowserPane";
import { countOf, folderName, openTarget, sections, type PortRow } from "./rows";
import { openUrl } from "./urls";
import { usePorts } from "./usePorts";

type Props = { workspaces: string[]; /** Only this workspace's ports are listed as the workspace's own. */ active?: string };

const mac = () => typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

function PortIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.5 8h11M8 2.5c1.7 1.6 2.5 3.4 2.5 5.5S9.7 11.9 8 13.5M8 2.5C6.3 4.1 5.5 5.9 5.5 8s.8 3.9 2.5 5.5" />
    </svg>
  );
}

export default function PortsItem({ workspaces, active }: Props) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ left: number; bottom: number }>({ left: 8, bottom: 28 });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const { rows, problem, book, refresh } = usePorts(workspaces, true, open);
  const { mine, external } = sections(rows, active);

  const toggle = () => {
    const r = button.current?.getBoundingClientRect();
    if (r) setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - 440)), bottom: window.innerHeight - r.top + 4 });
    setNote("");
    setOpen((o) => !o);
  };
  const go = (row: PortRow, e: MouseEvent) => {
    const url = openUrl(row.port, row.address, book.get(row.port));
    if (openTarget(e, mac()) === "system") invoke("open_external", { url }).catch((err) => setNote(String(err)));
    else openInBrowser(url);
  };
  const stop = async (row: PortRow) => {
    setBusy(row.port);
    try {
      const done = await invoke<string>("ports_stop", { worktrees: workspaces, port: row.port });
      setNote(done === "gone" ? `Port ${row.port} had already stopped` : `Stopped port ${row.port}`);
    } catch (err) {
      setNote(String(err));
    } finally {
      setBusy(null);
      void refresh();
    }
  };
  const line = (row: PortRow, canStop: boolean) => (
    <div key={`${row.port}-${row.pid}`} className="ports-row" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, alignItems: "center", padding: "6px 8px" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={openUrl(row.port, row.address, book.get(row.port))}>
          <span style={{ font: "12px var(--mono-font)" }}>:{row.port}</span> {openUrl(row.port, row.address, book.get(row.port))}
        </div>
        <div style={{ color: "var(--fg-muted)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.name || "a program"}
          {row.worktree ? ` · ${folderName(row.worktree)}` : " · external"}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button className="btn" title="Open in the Kolux browser. Shift+Ctrl-click opens your system browser" onClick={(e) => go(row, e)}>
          Open
        </button>
        {canStop && (
          <button className="btn danger" disabled={busy === row.port} aria-label={`Stop port ${row.port}`} onClick={() => void stop(row)}>
            Stop
          </button>
        )}
      </div>
    </div>
  );
  return (
    <>
      <button ref={button} className="item ports-item" style={{ color: "inherit", font: "inherit", padding: "0 4px", borderRadius: 4, background: open ? "var(--row-selected)" : undefined }} title="Ports your workspaces are listening on" aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
        <PortIcon />
        {countOf(rows, active)}
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="menu ports-menu" role="dialog" aria-label="Ports" style={{ ...at, width: 420, maxWidth: "calc(100vw - 16px)", maxHeight: "60vh", overflowY: "auto" }}>
            <div className="menu-title">Ports</div>
            {problem && <div role="alert" style={{ padding: "4px 8px", color: "var(--fg-muted)" }}>The port scan failed: {problem}. Showing the last list.</div>}
            {note && <div role="status" style={{ padding: "4px 8px", color: "var(--fg-muted)" }}>{note}</div>}
            {mine.length === 0 && <div style={{ padding: "6px 8px", color: "var(--fg-muted)" }}>Nothing in your workspaces is listening on a port.</div>}
            {mine.map((r) => line(r, true))}
            {external.length > 0 && (
              <>
                <div className="menu-title" style={{ marginTop: 6 }}>External ({external.length})</div>
                {external.slice(0, 30).map((r) => line(r, false))}
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
