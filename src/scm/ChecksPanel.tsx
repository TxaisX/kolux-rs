// VIEW-073: the Checks tab of the right sidebar. It follows the worktree of the focused terminal and
// shows that branch's pull request: a review header, a merge conflict notice when there is one, and
// every check, each opening to its details. Running checks are asked about again while the tab is in
// view; Refresh asks at once. A branch with no pull request says so, and that answer is reused for a
// short while instead of asking gh again.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { Refresh } from "../chrome/icons";
import { CHECKS_POLL_MS, checksSummary, reuseNoPr, stillRunning, type PrChecks } from "./checks";
import { prStateWord } from "./model";

type Props = { dir: string | null; linked: string | null; visible: boolean };

/** When each worktree last answered "no pull request", kept across tab switches. */
const noPrSeen = new Map<string, number>();

const when = (t?: string | null) => (t ? new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : null);

export default function ChecksPanel({ dir, linked, visible }: Props) {
  const key = dir === null ? null : `${dir}|${linked ?? ""}`;
  const [got, setGot] = useState<{ key: string; data: PrChecks | null; error: string | null; loading: boolean } | null>(null);
  const asking = useRef<string | null>(null);
  asking.current = key;
  // The answer on screen is only ever this worktree's; an older one never stands in for it.
  const shown = got && got.key === key ? got : null;

  const load = (force: boolean) => {
    if (key === null || dir === null) return;
    if (!force && reuseNoPr(noPrSeen, key, Date.now())) return setGot({ key, data: { pr: null, conflict: false, checks: [] }, error: null, loading: false });
    setGot((g) => (g && g.key === key ? { ...g, loading: true } : { key, data: null, error: null, loading: true }));
    invoke<PrChecks>("scm_pr_checks", { worktree: dir, linked })
      .then((data) => {
        if (asking.current !== key) return;
        if (data.pr) noPrSeen.delete(key);
        else noPrSeen.set(key, Date.now());
        setGot({ key, data, error: null, loading: false });
      })
      .catch((err) => asking.current === key && setGot((g) => ({ key, data: g?.key === key ? g.data : null, error: String(err), loading: false })));
  };

  useEffect(() => {
    if (visible) load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, visible]);
  // Polling runs only while the tab is in view and a check is still running.
  const running = !!shown?.data && stillRunning(shown.data.checks);
  useEffect(() => {
    if (!visible || !running || shown?.loading) return;
    const t = setTimeout(() => load(true), CHECKS_POLL_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, running, shown?.loading, key]);

  const data = shown?.data ?? null;
  const pr = data?.pr ?? null;
  return (
    <aside className="sidebar-wrap right">
      <div className="sidebar scm checks-panel">
        <div className="sb-section scm-head">
          <span>Checks</span>
          {pr && <span className="count">{data!.checks.length}</span>}
          <div className="icons">
            {dir !== null && (
              <button className="ib" title={shown?.loading ? "Looking…" : "Refresh the checks"} aria-label="Refresh the checks" disabled={!!shown?.loading} onClick={() => load(true)}>
                <Refresh />
              </button>
            )}
          </div>
        </div>
        {dir === null ? (
          <div className="sb-hint">Open a workspace to see its pull request's checks.</div>
        ) : shown?.error ? (
          <div className="note error">The checks could not be read: {shown.error}</div>
        ) : !data ? (
          <div className="sb-hint">Looking for this branch's pull request…</div>
        ) : !pr ? (
          <div className="sb-hint">There is no review for this branch: it has no pull request.</div>
        ) : (
          <>
            <div className="scm-prrow checks-review">
              <span className={`scm-prstate ${pr.state.toLowerCase()}`}>{prStateWord(pr)}</span>
              <span className="scm-prtitle" title={pr.title ?? undefined}>
                #{pr.number} {pr.title}
              </span>
            </div>
            {data.conflict && <div className="note warn">This pull request has merge conflicts with its base branch; it cannot merge until they are resolved.</div>}
            <div className="sb-hint checks-sum">{checksSummary(data.checks)}</div>
            <div className="checks-list">
              {data.checks.map((c, i) => (
                <details key={`${c.name}-${i}`} className="check-row" data-outcome={c.outcome}>
                  <summary>
                    <span className={`check-dot ${c.outcome}`} aria-hidden="true" />
                    <span className="name" title={c.name}>
                      {c.name}
                    </span>
                    {c.workflow && <span className="wf">{c.workflow}</span>}
                    <span className={`word ${c.outcome}`}>{c.outcome}</span>
                  </summary>
                  <div className="check-detail">
                    {c.description && <div>{c.description}</div>}
                    {when(c.started) && <div>Started {when(c.started)}</div>}
                    {when(c.finished) && <div>Finished {when(c.finished)}</div>}
                    {c.outcome === "unresolved" && <div>It finished without reporting an outcome.</div>}
                    {c.link && (
                      <button className="btn" onClick={() => void invoke("open_external", { url: c.link })}>
                        Open the check's page
                      </button>
                    )}
                  </div>
                </details>
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
