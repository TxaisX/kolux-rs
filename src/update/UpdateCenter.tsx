// APP-024..027 on screen: the quiet timetable, the automatic download, the update card a
// requested check brings up, and the small "ready" pop-up. Both sit in the bottom-left corner,
// above the sidebar's "Check for updates" button.
import { useEffect, useReducer, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { savePoint } from "../lifecycle";
import { Close, Refresh, Spinner, CheckCircle } from "../chrome/icons";
import { Quietly, TICK_MS, UpdateSchedule, type Outcome, type Quiet } from "./schedule";
import { cardReducer, initialCard, mainAction, tipVisible, RELEASES_PAGE, type LastLaunch, type UpdateInfo } from "./card";

interface Status {
  enabled: boolean;
  reason: string | null;
  currentVersion: string;
  lastCheckAt: number | null;
  dismissedVersion: string | null;
  tipDone: boolean;
  ready: UpdateInfo | null;
  lastLaunch: LastLaunch | null;
  /** APP-031: built on this computer (a development copy or one without the release key). */
  local: boolean;
}

const EVENT = "kolux-check-updates";
/** The sidebar's Check for updates button. */
export function requestUpdateCheck() {
  window.dispatchEvent(new Event(EVENT));
}

const FADE_MS = 2500;

export default function UpdateCenter() {
  const [s, dispatch] = useReducer(cardReducer, initialCard(null, true));
  const status = useRef<Status | null>(null);
  const schedule = useRef<UpdateSchedule<UpdateInfo> | null>(null);
  const downloading = useRef<string | null>(null);
  const cardEl = useRef<HTMLDivElement | null>(null);

  const download = (info: UpdateInfo) => {
    // A requested check that finds the update already downloading shows that download.
    dispatch({ type: "downloadStart", info });
    if (downloading.current === info.version) return;
    downloading.current = info.version;
    invoke<UpdateInfo>("update_download").then(
      (done) => {
        downloading.current = null;
        dispatch({ type: "ready", info: { ...done, notes: done.notes.length ? done.notes : info.notes } });
      },
      (e) => {
        downloading.current = null;
        dispatch({ type: "downloadFailed", info, message: String(e), offline: !navigator.onLine });
      },
    );
  };

  const onOutcome = (o: Outcome<UpdateInfo>, requested: boolean) => {
    if (o.ok) {
      dispatch({ type: "checkDone", requested, found: o.found, quiet: o.quiet });
      if (o.found) download(o.found); // APP-024/025: the download starts by itself
    } else if (o.error !== "offline") {
      dispatch({ type: "checkFailed", requested, message: o.error, offline: o.offline, local: status.current?.local });
    }
  };

  const check = () => {
    const st = status.current;
    if (!st) return;
    dispatch({ type: "checkStart", requested: true });
    if (!st.enabled || !schedule.current) {
      dispatch({ type: "checkFailed", requested: true, message: st.reason ?? "Updates are off in this copy.", offline: false, next: st.local ? "Build it again from the source to get newer changes." : "Install Kolux RS from its releases page to get updates." });
      return;
    }
    void schedule.current.run(true);
  };

  useEffect(() => {
    let alive = true;
    const offs: Array<() => void> = [];
    void invoke<Status>("update_status").then((st) => {
      if (!alive) return;
      status.current = st;
      // Start from what the store remembers.
      dispatch({ type: "hydrate", dismissed: st.dismissedVersion, tipDone: st.tipDone });
      if (st.ready) dispatch({ type: "ready", info: st.ready });
      else if (st.lastLaunch) dispatch({ type: "lastLaunch", launch: st.lastLaunch, local: st.local });
      if (!st.enabled) return;
      const sched = new UpdateSchedule<UpdateInfo>(
        {
          now: () => Date.now(),
          setTimer: (fn, ms) => window.setTimeout(fn, ms),
          clearTimer: (h) => window.clearTimeout(h as number),
          online: () => navigator.onLine,
          check: async () => {
            dispatch({ type: "checkStart", requested: false });
            const r = await invoke<{ found: UpdateInfo | null; quiet: Quiet | null }>("update_check");
            return r.quiet ? new Quietly(r.quiet) : r.found;
          },
          onOutcome,
        },
        st.lastCheckAt,
      );
      schedule.current = sched;
      sched.start();
      const tick = window.setInterval(() => sched.tick(), TICK_MS);
      const onFocus = () => sched.focus();
      const onOnline = () => sched.online();
      window.addEventListener("focus", onFocus);
      window.addEventListener("online", onOnline);
      offs.push(() => {
        window.clearInterval(tick);
        window.removeEventListener("focus", onFocus);
        window.removeEventListener("online", onOnline);
        sched.stop();
      });
    });
    const unlisten = listen<{ version: string; received: number; total: number | null }>("update-progress", (e) =>
      dispatch({ type: "progress", version: e.payload.version, received: e.payload.received, total: e.payload.total }),
    );
    const onAsk = () => check();
    window.addEventListener(EVENT, onAsk);
    return () => {
      alive = false;
      offs.forEach((f) => f());
      void unlisten.then((f) => f());
      window.removeEventListener(EVENT, onAsk);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Up to date: the card closes itself.
  useEffect(() => {
    if (s.phase.kind !== "upToDate") return;
    const t = window.setTimeout(() => dispatch({ type: "faded" }), FADE_MS);
    return () => window.clearTimeout(t);
  }, [s.phase.kind]);

  // What the store remembers follows the card.
  useEffect(() => {
    if (s.dismissed && s.dismissed !== status.current?.dismissedVersion) {
      void invoke("update_mark", { key: "dismissedVersion", value: s.dismissed });
      if (status.current) status.current.dismissedVersion = s.dismissed;
    }
  }, [s.dismissed]);
  useEffect(() => {
    if (s.tipDone && status.current && !status.current.tipDone) {
      status.current.tipDone = true;
      void invoke("update_mark", { key: "tipDone", value: "1" });
    }
  }, [s.tipDone]);

  // The card takes the keyboard when it opens on the user's click, so Escape and Enter reach it.
  useEffect(() => {
    if (s.shown && !s.collapsed && s.requested) cardEl.current?.focus();
  }, [s.shown, s.collapsed, s.requested, s.phase.kind]);

  // On success the app ends here and the installer takes over. APP-029: when the installer cannot
  // start, the card says why and the update stays ready for Try again.
  const restart = () => {
    const info = "info" in s.phase ? s.phase.info : null;
    // APP-011: the installer starts only after a durable save point; a refused one says why here.
    void savePoint().then(() => invoke("update_restart")).catch((e) => {
      const message = e instanceof Error ? e.message : String(e);
      if (message === "No update is ready.") dispatch({ type: "notReady" });
      else dispatch({ type: "installFailed", info, message });
    });
  };
  const act = () => {
    const a = mainAction(s.phase);
    if (a === "close") dispatch({ type: "faded" });
    else if (a === "download" && "info" in s.phase && s.phase.info) download(s.phase.info);
    else if (a === "restart") restart();
    else if (a === "retryCheck") check();
    else if (a === "retryDownload" && s.phase.kind === "error" && s.phase.info) download(s.phase.info);
  };

  const p = s.phase;
  const version = "info" in p && p.info ? p.info.version : null;
  const title =
    p.kind === "checking"
      ? "Checking for updates…"
      : p.kind === "upToDate"
        ? p.note
          ? "No update to install yet"
          : `Kolux RS is up to date`
        : p.kind === "available"
          ? `Kolux RS ${version} is available`
          : p.kind === "downloading"
            ? `Downloading Kolux RS ${version}`
            : p.kind === "ready"
              ? `Kolux RS ${version} is ready`
              : p.kind === "updated"
                ? `Kolux RS was updated to ${p.version}`
              : p.kind === "error"
                ? p.installer || p.retry === "restart"
                  ? `Kolux RS ${version} did not install`
                  : p.retry === "check"
                  ? "The update check failed"
                  : `Kolux RS ${version} did not download`
                : "";
  const pct = p.kind === "downloading" && p.total ? Math.min(100, Math.round((p.received / p.total) * 100)) : null;
  const action = mainAction(p);
  const actionLabel = action === "restart" ? (p.kind === "error" ? "Try again" : "Restart to update") : action === "download" ? "Download" : action === "retryCheck" || action === "retryDownload" ? "Try again" : action === "close" ? "OK" : null;

  return (
    <>
      {s.shown && p.kind !== "idle" && (
        <div className="upd-wrap" aria-live="polite">
          {tipVisible(s) && (
            <div className="upd-tip" role="note">
              Your terminal sessions keep running while Kolux RS updates.
              <button className="ib" title="Got it" onClick={() => dispatch({ type: "tipDismiss" })}>
                <Close size={11} />
              </button>
            </div>
          )}
          <div
            ref={cardEl}
            className={`upd-card ${s.collapsed ? "collapsed" : ""} ${p.kind}`}
            role="dialog"
            aria-label="Updates"
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                dispatch({ type: "collapse" });
              } else if (e.key === "Enter" && e.target === e.currentTarget) {
                e.preventDefault();
                act();
              }
            }}
          >
            <div className="upd-head" onClick={() => s.collapsed && dispatch({ type: "expand" })}>
              <span className="upd-icon">
                {p.kind === "checking" || p.kind === "downloading" ? <Spinner size={13} /> : p.kind === "upToDate" || p.kind === "ready" ? <CheckCircle size={13} /> : <Refresh size={13} />}
              </span>
              <span className="upd-title">{title}</span>
              {pct !== null && <span className="upd-pct">{pct}%</span>}
              <button className="ib" title={s.collapsed ? "Expand" : "Collapse (Esc)"} onClick={(e) => (e.stopPropagation(), dispatch({ type: s.collapsed ? "expand" : "collapse" }))}>
                {s.collapsed ? "▴" : "▾"}
              </button>
              <button className="ib" title="Dismiss" onClick={(e) => (e.stopPropagation(), dispatch({ type: "dismiss" }))}>
                <Close size={11} />
              </button>
            </div>
            {!s.collapsed && (
              <div className="upd-body">
                {p.kind === "error" && (
                  <>
                    <div className="upd-err">{p.message}</div>
                    <div className="upd-next">{p.next}</div>
                  </>
                )}
                {p.kind === "downloading" && (
                  <div className="upd-bar" role="progressbar" aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
                    <div style={{ width: `${pct ?? 0}%` }} />
                  </div>
                )}
                {p.kind === "upToDate" && p.note && <div className="upd-next">{p.note}</div>}
                {p.kind === "updated" && <div className="upd-next">What is new in this version:</div>}
                {s.notes.length > 0 && p.kind !== "checking" && p.kind !== "upToDate" && (
                  <ul className="upd-notes">
                    {s.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                )}
                {p.kind === "ready" && <div className="upd-next">It also installs by itself the next time you quit.</div>}
                {actionLabel && (
                  <div className="upd-actions">
                    <button className={`btn ${action === "restart" || action === "download" ? "primary" : ""}`} onClick={act}>
                      {actionLabel}
                    </button>
                    {p.kind === "error" && p.installer && (
                      <button className="btn" onClick={() => void invoke("open_external", { url: RELEASES_PAGE })}>
                        Download installer
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {/* The pop-up waits while the open card takes the same corner. */}
      {s.popup && !(s.shown && p.kind !== "idle" && (version === s.popup || !s.collapsed)) && (
        <div className="upd-pop" role="status">
          <CheckCircle size={13} />
          <span>Kolux RS {s.popup} is ready</span>
          <button className="btn primary" onClick={restart}>
            Restart to update
          </button>
          <button className="ib" title="Close" onClick={() => dispatch({ type: "popupClose" })}>
            <Close size={11} />
          </button>
        </div>
      )}
    </>
  );
}
