// The Source Control card on the right of the content (spec 11; GIT-002 / GIT-004 / GIT-006 /
// GIT-007): the changes of the workspace in front under conflicts, staged, changes and untracked,
// each section with its count and a stage-all / unstage-all control, plus or minus on every row,
// a commit box (Ctrl+Enter commits while focus is in here), the main button that always proposes
// the next step, a remote menu whose labels carry counts and whose disabled items say why, and a
// notice when an action fails or a hook refuses a commit, with a Fix with AI action. The draft
// message is the window's, keyed by worktree, so it survives closing the panel and switching
// workspaces. Every call names the worktree. VIEW-067: every row and every section but Conflicts
// can be discarded, always after a prompt that says what will happen. VIEW-068: a branch summary on top (ahead / behind
// the base and the lines changed, split into source, tests and generated).
// Rows select on click (Ctrl adds, Shift spans), and a bulk bar above the list says how many of
// the selected rows Stage and Unstage will each cover (T-018-c); Escape clears the selection.
// ponytail: the list refreshes after each action and every 4 s while the panel is open; the
// watcher that shows a commit typed in a terminal at once comes with GIT-001 (T-033), and the
// pull-request step (create, merged, loading) with GIT-021 (T-228).
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Ask from "../chrome/Ask";
import { ChevronDown, Close, Minus, Plus, Refresh, Undo } from "../chrome/icons";
import type { AgentInfo } from "../launch/PlusMenu";
import HandoffNote from "./HandoffNote";
import { canCommit, changeCount, conflictPrompt, grouped, savedFixAgent, isCommitShortcut, nextStep, remoteItems, summaryLabel, summaryRows, summaryTotal, type ActionOutcome, type Change, type CommitOutcome, type RemoteAction, type Status, type Summary, bulk, rowOrder, select, discardAsk, type DiscardAsk, type Section } from "./model";

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
  /** VIEW-069: the agent saved for agent actions (skips the dialog), saving or clearing it, and the
   *  start itself, which resolves to why it failed (null once the agent has its prompt). */
  fixAgent: unknown;
  onFixAgent: (id: string | null) => void;
  onAgentAction: (agent: AgentInfo, prompt: string) => Promise<string | null>;
};

type Asking = { agent: string; prompt: string; remember: boolean };

type Failure = { title: string; output: string };

// VIEW-069: an agent action runs once at a time; the button stays greyed until the start has an answer.
export default function SourceControlPanel({ dir, draft, onDraft, onClose, onFix, pinnedBase, againstUpstream, onAgainstUpstream, agents, onHand, fixAgent, onFixAgent, onAgentAction }: Props) {
  const [asking, setAsking] = useState<Asking | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const starting = useRef(false);
  const [busyAgent, setBusyAgent] = useState(false);
  const saved = savedFixAgent(agents, fixAgent);
  const runAgent = async (agent: AgentInfo, prompt: string) => {
    if (starting.current) return;
    starting.current = true;
    setBusyAgent(true);
    setAgentError(null);
    const why = await onAgentAction(agent, prompt);
    starting.current = false;
    setBusyAgent(false);
    if (why) setAgentError(why);
  };
  const resolveConflicts = (files: Change[]) => {
    const prompt = conflictPrompt(files);
    if (saved) return void runAgent(saved, prompt);
    setAsking({ agent: agents[0]?.id ?? "", prompt, remember: false });
  };
  const confirmAsk = () => {
    const a = asking && agents.find((x) => x.id === asking.agent);
    if (!asking || !a || !asking.prompt.trim()) return;
    if (asking.remember) onFixAgent(a.id);
    setAsking(null);
    void runAgent(a, asking.prompt);
  };
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const remoteButton = useRef<HTMLButtonElement>(null);
  const [discarding, setDiscarding] = useState<(DiscardAsk & { section: Section }) | null>(null);

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
    setSelected([]);
    setAnchor(null);
    setDiscarding(null);
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
  const askDiscard = (section: Section, rows: Change[], all: boolean) => rows.length > 0 && setDiscarding({ ...discardAsk(section, rows, all), section });
  const discard = (d: DiscardAsk & { section: Section }) => {
    setDiscarding(null);
    const section = d.section === "Changes" ? "changed" : d.section.toLowerCase();
    void guarded(() => invoke("scm_discard", { worktree: dir, section, paths: d.paths }));
  };
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

  const pick = (path: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    if (!status) return;
    setSelected((prev) => select(prev, rowOrder(status), path, e.shiftKey ? "span" : e.ctrlKey || e.metaKey ? "toggle" : "one", anchor));
    if (!e.shiftKey) setAnchor(path);
  };
  const chosen = status ? bulk(status, selected) : { present: [], stage: [], unstage: [] };

  const section = (name: "Conflicts" | Section, rows: Change[], on: boolean) =>
    rows.length > 0 && (
      <div className="scm-sec-wrap" data-section={name}>
        <div className="scm-sec">
          <span>{name}</span>
          <span className="count">{rows.length}</span>
          {name !== "Conflicts" && (
            <button className="ib" title={`Discard all ${rows.length}`} aria-label={`Discard all in ${name}`} disabled={busy} onClick={() => askDiscard(name, rows, true)}>
              <Undo />
            </button>
          )}
          <button className="ib" title={on ? `Stage all ${rows.length}` : `Unstage all ${rows.length}`} disabled={busy} onClick={() => void stage(rows.map((r) => r.path), on)}>
            {on ? <Plus /> : <Minus />}
          </button>
        </div>
        {rows.map((r) => (
          <div key={r.path} className="scm-row" aria-selected={selected.includes(r.path)} title={r.from ? `${r.from} → ${r.path}` : r.path} onClick={(e) => pick(r.path, e)}>
            <span className="letter">{r.status}</span>
            <span className="path">{r.from ? `${r.from} → ${r.path}` : r.path}</span>
            {name !== "Conflicts" && (
              <button className="ib" title="Discard" aria-label={`Discard ${r.path}`} disabled={busy} onClick={(e) => { e.stopPropagation(); askDiscard(name, [r], false); }}>
                <Undo />
              </button>
            )}
            <button
              className="ib"
              title={on ? "Stage" : "Unstage"}
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                void stage([r.path], on);
              }}
            >
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
        if (e.key === "Escape" && selected.length > 0) {
          setSelected([]);
          return;
        }
        if (!isCommitShortcut(e.nativeEvent)) return;
        e.preventDefault();
        void commit();
      }}
    >
      {discarding && <Ask title={discarding.title} body={discarding.body} confirm={discarding.confirm} onConfirm={() => discard(discarding)} onCancel={() => setDiscarding(null)} />}
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
            {status && status.conflicts.length > 0 && (
              <div className="btn-row" data-agent-action="resolve-conflicts">
                <button className="btn" disabled={busyAgent || agents.length === 0} title={agents.length === 0 ? "No agent was found on this computer" : undefined} onClick={() => resolveConflicts(status.conflicts)}>
                  {saved ? `Resolve conflicts with ${saved.name}` : "Resolve conflicts with an agent…"}
                </button>
                {saved && (
                  <button className="btn" title="Pick the agent and check the prompt each time" onClick={() => onFixAgent(null)}>
                    Ask each time
                  </button>
                )}
              </div>
            )}
            {asking && (
              <div className="scm-ask" role="dialog" aria-label="Resolve conflicts with an agent">
                <select aria-label="agent to start" className="field" value={asking.agent} onChange={(e) => setAsking({ ...asking, agent: e.target.value })}>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <textarea aria-label="prompt for the agent" className="field multi" value={asking.prompt} onChange={(e) => setAsking({ ...asking, prompt: e.target.value })} />
                <label className="conn-switch">
                  <input type="checkbox" checked={asking.remember} onChange={(e) => setAsking({ ...asking, remember: e.target.checked })} />
                  <span>Start this agent without asking next time</span>
                </label>
                <div className="btn-row">
                  <button className="btn primary" disabled={!asking.prompt.trim()} onClick={confirmAsk}>
                    Start
                  </button>
                  <button className="btn" onClick={() => setAsking(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {agentError && (
              <div className="note error" role="alert">
                {agentError}
              </div>
            )}
            {chosen.present.length > 0 && (
              <div className="scm-bulk" role="toolbar" aria-label="Selected rows">
                <span className="count">{chosen.present.length} selected</span>
                <button className="btn" disabled={busy || chosen.stage.length === 0} title={`Stage the ${chosen.stage.length} selected unstaged rows`} onClick={() => void stage(chosen.stage, true)}>
                  Stage {chosen.stage.length}
                </button>
                <button className="btn" disabled={busy || chosen.unstage.length === 0} title={`Unstage the ${chosen.unstage.length} selected staged rows`} onClick={() => void stage(chosen.unstage, false)}>
                  Unstage {chosen.unstage.length}
                </button>
                <button className="ib" title="Clear selection (Esc)" onClick={() => setSelected([])}>
                  <Close />
                </button>
              </div>
            )}
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
