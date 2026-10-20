// VIEW-084 (T-127-b): the expandable part of a past session's row: the agent, the first prompt, a
// preview of the latest turn, child runs with state dots, and the worktree line. It is its own
// button, so choosing Resume or Copy command on the row never expands it. The transcript is read
// (session_row_detail) only when the row is opened.
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./rows.css";
import { childCount, childState, promptHeading, worktreeLine, type Detail } from "./rows";

type Props = {
  session: { agent: string; id: string; dir: string | null };
  activeDir: string | null;
  /** Every workspace folder open in Kolux, so the line can say active. */
  openDirs: string[];
  onJump?: (dir: string) => void;
};

export default function SessionDetail({ session, activeDir, openDirs, onJump }: Props) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setError(null);
      invoke<Detail>("session_row_detail", { agent: session.agent, id: session.id, dir: session.dir })
        .then(setDetail)
        .catch((e) => setError(String(e)));
    }
  };
  const line = worktreeLine(session.dir, detail?.dirExists ?? null, activeDir, openDirs);
  return (
    <div className="session-detail">
      <button type="button" className="btn session-detail-toggle" aria-expanded={open} title="Show the first prompt, the latest turn and the sub-agents" onClick={toggle}>
        {open ? "Hide details" : "Details"}
      </button>
      {open && (
        <div className="session-detail-body">
          {error !== null && <div className="sb-hint warn">{error}</div>}
          {error === null && detail === null && <div className="sb-hint">Reading the session…</div>}
          {detail !== null && (
            <>
              <div className="session-card" data-prompt>
                <div className="session-card-head">{promptHeading(detail)}</div>
                <div className="session-card-text">{detail.prompt ?? "No prompt could be read."}</div>
              </div>
              {detail.latest !== null && (
                <div className="session-card" data-latest>
                  <div className="session-card-head">Latest turn</div>
                  <div className="session-card-text">{detail.latest}</div>
                </div>
              )}
              {detail.children.length > 0 && (
                <ul className="session-children" aria-label={childCount(detail.children.length)}>
                  {detail.children.map((c) => (
                    <li key={c.id} title={`${c.title}\n${childState(c)}`}>
                      <span className={`session-dot ${childState(c)}`} role="img" aria-label={childState(c)} />
                      <span className="session-child-title">{c.title === "" ? "Sub-agent" : c.title}</span>
                    </li>
                  ))}
                </ul>
              )}
              {line.jump && onJump && session.dir !== null ? (
                <button type="button" className={`btn session-worktree ${line.state}`} title={line.tip} onClick={() => onJump(session.dir as string)}>
                  {line.label}
                </button>
              ) : (
                <span className={`session-worktree ${line.state}`} title={line.tip}>
                  {line.label}
                </span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
