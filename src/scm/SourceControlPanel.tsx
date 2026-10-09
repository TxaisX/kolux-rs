// The Source Control card on the right of the content (spec 11; GIT-002 / GIT-004): the changes
// of the workspace in front under conflicts, staged, changes and untracked, each section with
// its count and a stage-all / unstage-all control, plus or minus on every row, a commit box
// (Ctrl+Enter commits while focus is in here), and a notice when a commit fails or a hook
// refuses it, with a Fix with AI action. The draft message is the window's, keyed by worktree,
// so it survives closing the panel and switching workspaces. Every call names the worktree.
// ponytail: the list refreshes after each action and every 4 s while the panel is open; the
// watcher that shows a commit typed in a terminal at once comes with GIT-001 (T-033), and the
// bulk bar for several selected rows with T-018-c.
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Close, Minus, Plus, Refresh } from "../chrome/icons";
import { canCommit, changeCount, isCommitShortcut, type Change, type CommitOutcome, type Status } from "./model";

type Props = {
  /** The workspace in front; null outside any workspace. */
  dir: string | null;
  draft: string;
  onDraft: (text: string) => void;
  onClose: () => void;
  /** GIT-004: starts an agent primed with what git and its hooks printed. */
  onFix: (output: string) => void;
};

export default function SourceControlPanel({ dir, draft, onDraft, onClose, onFix }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CommitOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (dir === null) {
      setStatus(null);
      return;
    }
    try {
      setStatus(await invoke<Status>("scm_status", { worktree: dir }));
      setError(null);
    } catch (err) {
      setStatus(null);
      setError(String(err));
    }
  }, [dir]);
  useEffect(() => {
    setOutcome(null);
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [load]);

  const act = async (paths: string[], on: boolean) => {
    if (dir === null || paths.length === 0 || busy) return;
    setBusy(true);
    try {
      await invoke("scm_stage", { worktree: dir, paths, on });
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
      await load();
    }
  };
  const commit = async () => {
    if (dir === null || busy || !canCommit(status, draft)) return;
    setBusy(true);
    try {
      const out = await invoke<CommitOutcome>("scm_commit", { worktree: dir, message: draft });
      setOutcome(out);
      if (out.id) onDraft("");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
      await load();
    }
  };

  const section = (name: string, rows: Change[], on: boolean) =>
    rows.length > 0 && (
      <div className="scm-sec-wrap" data-section={name}>
        <div className="scm-sec">
          <span>{name}</span>
          <span className="count">{rows.length}</span>
          <button className="ib" title={on ? `Stage all ${rows.length}` : `Unstage all ${rows.length}`} disabled={busy} onClick={() => void act(rows.map((r) => r.path), on)}>
            {on ? <Plus /> : <Minus />}
          </button>
        </div>
        {rows.map((r) => (
          <div key={r.path} className="scm-row" title={r.from ? `${r.from} → ${r.path}` : r.path}>
            <span className="letter">{r.status}</span>
            <span className="path">{r.from ? `${r.from} → ${r.path}` : r.path}</span>
            <button className="ib" title={on ? "Stage" : "Unstage"} disabled={busy} onClick={() => void act([r.path], on)}>
              {on ? <Plus /> : <Minus />}
            </button>
          </div>
        ))}
      </div>
    );

  return (
    <aside
      className="sidebar-wrap right"
      onKeyDown={(e) => {
        if (!isCommitShortcut(e.nativeEvent)) return;
        e.preventDefault();
        void commit();
      }}
    >
      <div className="sidebar scm">
        <div className="sb-section scm-head">
          <span>Source Control</span>
          {status && <span className="count">{changeCount(status)}</span>}
          <div className="icons">
            <button className="ib" title="Refresh" onClick={() => void load()}>
              <Refresh />
            </button>
            <button className="ib" title="Close" onClick={onClose}>
              <Close />
            </button>
          </div>
        </div>
        {dir === null ? (
          <div className="sb-hint">Open a workspace to see its changes.</div>
        ) : (
          <>
            <div className="scm-commit">
              <textarea className="field multi" placeholder={status?.branch ? `Message (Ctrl+Enter to commit on ${status.branch})` : "Message (Ctrl+Enter to commit)"} value={draft} onChange={(e) => onDraft(e.target.value)} />
              <button className="btn primary" disabled={busy || !canCommit(status, draft)} onClick={() => void commit()}>
                Commit
              </button>
            </div>
            {outcome && outcome.id && (
              <div className="note ok" role="status">
                Committed {outcome.id}
              </div>
            )}
            {outcome && !outcome.id && (
              <div className="scm-out" role="alert">
                <details>
                  <summary>{outcome.blocked ? "Commit blocked by a hook" : "Commit failed"}</summary>
                  <pre>{outcome.output || "git gave no reason"}</pre>
                </details>
                <button className="btn" onClick={() => onFix(outcome.output)}>
                  Fix with AI
                </button>
              </div>
            )}
            {error && <div className="note error">{error}</div>}
            <div className="sb-list">
              {status && changeCount(status) === 0 && <div className="sb-hint">No changes{status.branch ? ` on ${status.branch}` : ""}.</div>}
              {status && section("Conflicts", status.conflicts, true)}
              {status && section("Staged", status.staged, false)}
              {status && section("Changes", status.changed, true)}
              {status && section("Untracked", status.untracked, true)}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
