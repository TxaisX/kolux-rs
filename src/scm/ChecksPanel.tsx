// VIEW-073: the Checks tab of the right sidebar. It follows the worktree of the focused terminal and
// shows that branch's pull request: a review header, a merge conflict notice when there is one, and
// every check, each opening to its details. Running checks are asked about again while the tab is in
// view; Refresh asks at once. A branch with no pull request says so, and that answer is reused for a
// short while instead of asking gh again.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { Refresh } from "../chrome/icons";
import { openInBrowser } from "../browser/BrowserPane";
import { useSettings } from "../settings/useSettings";
import PrStart from "./PrStart";
import { reviewHint, reviewWhere } from "./startPr";
import { CHECKS_POLL_MS, checksSummary, reuseNoPr, stillRunning, type PrChecks } from "./checks";
import { prStateWord } from "./model";
import { CHECK_CAP, capped, checkGroups } from "./review";
import type { Check } from "./checks";

type Props = { dir: string | null; linked: string | null; visible: boolean };

/** When each worktree last answered "no pull request", kept across tab switches. */
const noPrSeen = new Map<string, number>();

const GROUPS = [
  ["failing", "Failing"],
  ["pending", "Pending"],
  ["passing", "Passing"],
  ["other", "Not counted"],
] as const;

const when = (t?: string | null) => (t ? new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : null);

export default function ChecksPanel({ dir, linked, visible }: Props) {
  const [note, setNote] = useState<string | null>(null);
  const { settings } = useSettings();
  const inKolux = settings?.linksOpenInKolux === true;
  const rerun = (c: Check) => {
    setNote(null);
    invoke("scm_check_rerun", { worktree: dir, link: c.link, failedOnly: true })
      .then(() => setNote(`Asked GitHub to rerun ${c.name}`))
      .catch((err) => setNote(String(err)));
  };
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
          <PrStart dir={dir} onCreated={() => load(true)} />
        ) : (
          <>
            <div className="scm-prrow checks-review">
              <span className={`scm-prstate ${pr.state.toLowerCase()}`}>{prStateWord(pr)}</span>
              <a
                className="scm-prtitle"
                href={pr.url}
                data-review-link
                title={`${pr.title ?? ""}
${reviewHint(inKolux)}`.trim()}
                onClick={(e) => {
                  e.preventDefault();
                  if (reviewWhere(e, inKolux) === "kolux") openInBrowser(pr.url);
                  else void invoke("open_external", { url: pr.url });
                }}
              >
                #{pr.number} {pr.title}
              </a>
              <span className="sb-hint" data-review-hint>
                {reviewHint(inKolux)}
              </span>
            </div>
            {data.conflict && <div className="note warn">This pull request has merge conflicts with its base branch; it cannot merge until they are resolved.</div>}
            <div className="sb-hint checks-sum">{checksSummary(data.checks)}</div>
            {note && <div className="note">{note}</div>}
            {(() => {
              const groups = checkGroups(data.checks);
              const cap = capped(data.checks, CHECK_CAP, "checks");
              // GIT-029: only the first 100 checks are drawn, in their groups, with a note for the rest.
              const drawn = new Set(cap.shown);
              return (
                <div className="checks-list">
                  {GROUPS.map(([key, label]) => {
                    const rows = groups[key].filter((c) => drawn.has(c));
                    if (rows.length === 0) return null;
                    return (
                      <section key={key} className={`check-group ${key}`} data-group={key}>
                        <h4 className="check-group-title">
                          {label} <span className="count">{groups[key].length}</span>
                        </h4>
                        {rows.map((c, i) => (
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
                              {c.outcome === "neutral" && <div>It finished neutral, which is not counted as passed.</div>}
                              {c.link && (
                                <button className="btn" onClick={() => void invoke("open_external", { url: c.link })}>
                                  Open the check's page
                                </button>
                              )}
                              {c.outcome === "failed" && c.link && (
                                <button className="btn" onClick={() => rerun(c)}>
                                  Rerun failed jobs
                                </button>
                              )}
                            </div>
                          </details>
                        ))}
                      </section>
                    );
                  })}
                  {cap.note && <div className="sb-hint">{cap.note}</div>}
                </div>
              );
            })()}
          </>
        )}
      </div>
    </aside>
  );
}
