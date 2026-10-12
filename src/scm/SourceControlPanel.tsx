// The Source Control card on the right of the content (spec 11; GIT-002 / GIT-004 / GIT-006 /
// GIT-007): the changes of the workspace in front under conflicts, staged, changes and untracked,
// each section with its count and a stage-all / unstage-all control, plus or minus on every row,
// a commit box (Ctrl+Enter commits while focus is in here), the main button that always proposes
// the next step, a remote menu whose labels carry counts and whose disabled items say why, and a
// notice when an action fails or a hook refuses a commit, with a Fix with AI action. The draft
// message is the window's, keyed by worktree, so it survives closing the panel and switching
// workspaces. Every call names the worktree. VIEW-068: a branch summary on top (ahead / behind
// the base and the lines changed, split into source, tests and generated).
// ponytail: the list refreshes after each action and every 4 s while the panel is open; the
// watcher that shows a commit typed in a terminal at once comes with GIT-001 (T-033), the bulk
// bar for several selected rows with T-018-c, and the pull-request step (create, merged, loading)
// with GIT-021 (T-228).
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, Close, Minus, Plus, Refresh } from "../chrome/icons";
import type { AgentInfo } from "../launch/PlusMenu";
import HandoffNote from "./HandoffNote";
import { canCommit, changeCount, grouped, isCommitShortcut, nextStep, remoteItems, summaryLabel, summaryRows, summaryTotal, type ActionOutcome, type Change, type CommitOutcome, type RemoteAction, type Status, type Summary } from "./model";

type Props = {
  /** The workspace in front; null outside any workspace. */
  dir: string | null;
  draft: string;
  onDraft: (text: string) => void;
  onClose: () => void;
  /** GIT-004: starts an agent primed with what git and its hooks printed. */
  onFix: (output: string) => void;
  /** VIEW-068: the base pinned for the workspace's project, which the summary measures against. */
  pinnedBase: string | null;
  /** VIEW-068: the off-by-default setting to measure the summary against the upstream instead. */
  againstUpstream: boolean;
  onAgainstUpstream: (on: boolean) => void;
  /** EDIT-040: the agents found on this machine, the default first, for Hand to agent. */
  agents: AgentInfo[];
  onHand: (agent: AgentInfo, note: string) => void;
};

type Failure = { title: string; output: string };

export default function SourceControlPanel({ dir, draft, onDraft, onClose, onFix, pinnedBase, againstUpstream, onAgainstUpstream, agents, onHand }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null);
  const remoteButton = useRef<HTMLButtonElement>(null);

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
    setFailure(null);
    setInfo(null);
    setMenu(null);
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [load]);

  // VIEW-068: the branch summary is measured while the panel is open, when HEAD moves and at
  // least every 30 s; the last one stays on screen while the next is worked out.
  const [summary, setSummary] = useState<Summary | null>(null);
  useEffect(() => setSummary(null), [dir]);
  const head = status?.head ?? null;
  useEffect(() => {
    if (dir === null) return;
    const measure = () =>
      void invoke<Summary>("scm_summary", { worktree: dir, pinned: pinnedBase, upstream: againstUpstream })
        .then(setSummary)
        .catch(() => setSummary(null));
    measure();
    const timer = window.setInterval(measure, 30000);
    return () => window.clearInterval(timer);
  }, [dir, head, pinnedBase, againstUpstream]);

  /** Runs one back-end call with the busy flag held, then reloads. */
  const guarded = async (work: () => Promise<void>) => {
    if (dir === null || busy) return;
    setBusy(true);
    setInfo(null);
    try {
      await work();
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
      await load();
    }
  };
  const stage = (paths: string[], on: boolean) => paths.length > 0 && guarded(() => invoke("scm_stage", { worktree: dir, paths, on }));
  const commit = () =>
    canCommit(status, draft) &&
    guarded(async () => {
      const out = await invoke<CommitOutcome>("scm_commit", { worktree: dir, message: draft });
      if (out.id) {
        onDraft("");
        setFailure(null);
        setInfo(`Committed ${out.id}`);
      } else {
        setFailure({ title: out.blocked ? "Commit blocked by a hook" : "Commit failed", output: out.output });
      }
    });
  const remote = (action: RemoteAction, label: string) =>
    guarded(async () => {
      const out = await invoke<ActionOutcome>("scm_remote", { worktree: dir, action });
      if (out.ok) {
        setFailure(null);
        setInfo(`${label}: done`);
      } else {
        setFailure({ title: `${label} failed`, output: out.output });
      }
    });

  const step = nextStep(status, draft);
  const mainAction = () => {
    if (!status) return;
    switch (step.action) {
      case "stage":
        return stage([...status.changed, ...status.untracked].map((c) => c.path), true);
      case "commit":
        return commit();
      case "pr":
        // ponytail: the composer is GIT-021 (T-228); until then the button says where it leads.
        return setInfo("Creating a pull request comes with GIT-021 (T-228).");
      default:
        return remote(step.action, step.label);
    }
  };
  const openMenu = () => {
    const r = remoteButton.current?.getBoundingClientRect();
    if (r) setMenu({ left: Math.max(8, r.right - 250), top: r.bottom + 4 });
  };

  const section = (name: string, rows: Change[], on: boolean) =>
    rows.length > 0 && (
      <div className="scm-sec-wrap" data-section={name}>
        <div className="scm-sec">
          <span>{name}</span>
          <span className="count">{rows.length}</span>
          <button className="ib" title={on ? `Stage all ${rows.length}` : `Unstage all ${rows.length}`} disabled={busy} onClick={() => void stage(rows.map((r) => r.path), on)}>
            {on ? <Plus /> : <Minus />}
          </button>
        </div>
        {rows.map((r) => (
          <div key={r.path} className="scm-row" title={r.from ? `${r.from} → ${r.path}` : r.path}>
            <span className="letter">{r.status}</span>
            <span className="path">{r.from ? `${r.from} → ${r.path}` : r.path}</span>
            <button className="ib" title={on ? "Stage" : "Unstage"} disabled={busy} onClick={() => void stage([r.path], on)}>
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
            {summary && (
              <details className="scm-summary" data-summary>
                <summary aria-label={summaryLabel(status?.branch ?? null, summary)} title={`against ${summary.against}`}>
                  <span className="branch">{status?.branch ?? "Detached HEAD"}</span>
                  <span className="ab">
                    ↑{summary.ahead} ↓{summary.behind} {summary.against}
                  </span>
                  <span className="lines">
                    <span className="add">+{grouped(summaryTotal(summary).added)}</span> <span className="del">−{grouped(summaryTotal(summary).removed)}</span>
                  </span>
                </summary>
                {summaryRows(summary).map((r) => (
                  <div key={r.label} className="scm-sum-row" data-row={r.label}>
                    <span>{r.label}</span>
                    <span className="add">+{grouped(r.added)}</span>
                    <span className="del">−{grouped(r.removed)}</span>
                  </div>
                ))}
                <label className="check">
                  <input type="checkbox" aria-label="compare with the upstream" checked={againstUpstream} onChange={(e) => onAgainstUpstream(e.target.checked)} />
                  Compare with the upstream{pinnedBase ? ` (the pinned base ${pinnedBase} wins)` : ""}
                </label>
              </details>
            )}
            <div className="scm-commit">
              <textarea className="field multi" placeholder={status?.branch ? `Message (Ctrl+Enter to commit on ${status.branch})` : "Message (Ctrl+Enter to commit)"} value={draft} onChange={(e) => onDraft(e.target.value)} />
              <div className="scm-main">
                <button className="btn primary" title={step.reason ?? step.label} disabled={busy || step.reason !== null} onClick={() => void mainAction()}>
                  <span>{step.label}</span>
                </button>
                <button ref={remoteButton} className="btn" title="Remote actions" aria-haspopup="menu" aria-expanded={menu !== null} disabled={busy} onClick={openMenu}>
                  Remote <ChevronDown />
                </button>
              </div>
            </div>
            {menu && (
              <>
                <div className="menu-backdrop" onClick={() => setMenu(null)} aria-hidden="true" />
                <div className="menu" role="menu" aria-label="Remote actions" style={{ left: menu.left, top: menu.top }}>
                  <div className="menu-title">{status?.upstream ? `Remote · ${status.upstream}` : "Remote"}</div>
                  {remoteItems(status).map((item) => (
                    <button
                      key={item.id}
                      role="menuitem"
                      className="menu-item"
                      data-action={item.id}
                      disabled={item.reason !== null}
                      title={item.reason ?? item.label}
                      onClick={() => {
                        setMenu(null);
                        void remote(item.id, item.label);
                      }}
                    >
                      <span className="name">{item.label}</span>
                      {item.reason && <span className="reason">{item.reason}</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
            {info && (
              <div className="note ok" role="status">
                {info}
              </div>
            )}
            {failure && (
              <div className="scm-out" role="alert">
                <details>
                  <summary>{failure.title}</summary>
                  <pre>{failure.output || "git gave no reason"}</pre>
                </details>
                <button className="btn" onClick={() => onFix(failure.output)}>
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
            <HandoffNote dir={dir} agents={agents} onHand={onHand} />
          </>
        )}
      </div>
    </aside>
  );
}
