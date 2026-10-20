// SKILL-024: the notice that some Kolux skills installed outside Kolux are out of date.
// SKILL-026: the background update dialog: what qualifies, why the rest is kept (with a reinstall
// command), Update, Stop, the per-skill result, and Show log with the installer's output.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Close } from "../chrome/icons";
import SkillInstall from "./SkillInstall";
import { skillBar, SKILLS_SHOW_EVENT } from "./skillBarStore";
import type { Load } from "./skillBar";
import { STOP_LABEL, UPDATE_LABEL, UPDATING_LABEL, chipTone, freshKeys, noticeShown, noticeText, sumUpRun, updatable, type Checked } from "./updateNotice";

/** One notice per session, dismissed or not. */
let shownThisSession = false;

type Props = { workspace: string | null; settingsLoaded?: boolean; onChanged?: () => void; /** The Kolux skills the Install panel offers. */ bundled?: string[]; /** Types a command into the inline terminal without running it (T-244-b). */ onType?: (line: string) => void; /** SKILL-025: what the last check found, for the freshness pills. */ onFreshness?: (load: Load, checked: Checked | null) => void };

export default function SkillUpdate({ workspace, settingsLoaded = true, onChanged, bundled = [], onType, onFreshness }: Props) {
  const [checked, setChecked] = useState<Checked | null>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState(false);
  // SKILL-027: the run itself lives in the store, so it goes on (and the status bar shows it) with the dialog closed.
  const view = useSyncExternalStore(skillBar.subscribe, skillBar.get);
  const status = view.status;
  const [log, setLog] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const lastState = useRef<string | undefined>(undefined);

  const check = () => {
    onFreshness?.("checking", null);
    return invoke<Checked>("skills_update_check", { workspace }).then(
      (c) => (setChecked(c), onFreshness?.("ready", c)),
      () => (setChecked(null), onFreshness?.("failed", null)),
    );
  };
  useEffect(() => void check(), [workspace]);
  useEffect(() => {
    skillBar.sync();
    if (skillBar.takeWanted()) setOpen(true);
    const show = () => (skillBar.takeWanted(), setOpen(true), setNotice(false));
    window.addEventListener(SKILLS_SHOW_EVENT, show);
    return () => window.removeEventListener(SKILLS_SHOW_EVENT, show);
  }, []);
  useEffect(() => skillBar.reading(open), [open]);
  useEffect(() => () => skillBar.reading(false), []);
  // A finished run: look again, and let the page reload its list.
  useEffect(() => {
    if (status?.state === "done" && lastState.current !== "done") {
      check();
      onChanged?.();
    }
    lastState.current = status?.state;
  }, [status?.state]);
  useEffect(() => {
    if (!shownThisSession && noticeShown(checked, settingsLoaded, false)) {
      shownThisSession = true;
      setNotice(true);
    }
  }, [checked, settingsLoaded]);

  const dismiss = () => {
    setNotice(false);
    if (checked) invoke("skills_update_dismiss", { keys: freshKeys(checked) }).catch(() => undefined);
  };
  const busy = status?.state === "running" || status?.state === "stopping";
  const start = () => {
    if (!checked) return;
    setErr(null);
    setLog(false);
    const names = updatable(checked.report);
    invoke("skills_update_clear")
      .then(() => invoke("skills_update_start", { workspace, names }))
      .then(() => skillBar.begin(names))
      .catch((e) => setErr(String(e)));
  };
  // The dialog may be closed while the update runs: the status bar item carries it from here.
  const close = () => {
    setOpen(false);
    if (status?.state === "done") invoke("skills_update_clear").catch(() => undefined);
  };

  const rows = checked?.report.rows ?? [];
  return (
    <>
      {notice && !open && (
        <div className="skills-note" role="status">
          {noticeText(checked?.report.available ?? 0)}{" "}
          <button className="btn" onClick={() => (setOpen(true), setNotice(false))}>
            Review
          </button>{" "}
          <button className="btn" aria-label="Dismiss" onClick={dismiss}>
            <Close />
          </button>
        </div>
      )}
      {!notice && !open && (checked?.report.available ?? 0) > 0 && (
        <div className="skills-note" role="status">
          {noticeText(checked?.report.available ?? 0)}{" "}
          <button className="btn" onClick={() => setOpen(true)}>
            Review
          </button>
        </div>
      )}
      {open && (
        <div className="ask-backdrop" onMouseDown={close}>
          <div className="ask" role="dialog" aria-modal="true" aria-label="Update Kolux skills" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && close()}>
            <h2 className="ask-title">Update Kolux skills</h2>
            <div className="ask-body">
              <p>These skills were installed with the community skills installer. Only copies it recorded and you have not changed are updated.</p>
              <ul>
                {rows.map((r) => (
                  <li key={r.name}>
                    <strong>{r.name}</strong> {r.state === "available" ? "can be updated" : r.state === "current" ? "is up to date" : "was kept"}
                    {r.copies.flatMap((c) => c.chips).map((c, i) => (
                      <span key={i} className={`chip chip-${chipTone(c)}`}>
                        {c}
                      </span>
                    ))}
                    {r.reason && <div className="skills-note">{r.reason}</div>}
                    {r.reinstall && (
                      <div className="skills-note">
                        To reinstall it: <code>{r.reinstall}</code>
                      </div>
                    )}
                    {status?.results.filter((x) => x.name === r.name).map((x) => (
                      <div key={x.name} role="status">
                        {x.ok ? "Updated" : `Not updated${x.reason ? `: ${x.reason}` : ""}`}
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
              {err && <p className="skills-err">{err}</p>}
              {status?.state === "done" && <p role="status">{sumUpRun(status)}</p>}
              {bundled.length > 0 && <SkillInstall names={bundled} onType={onType} />}
              {status && status.state !== "running" && status.log && (
                <>
                  <button className="btn" onClick={() => setLog(!log)}>
                    {log ? "Hide log" : "Show log"}
                  </button>
                  {log && <pre className="skills-log">{status.log}</pre>}
                </>
              )}
            </div>
            <div className="btn-row">
              <button className="btn" onClick={close}>
                Close
              </button>
              {busy ? (
                <button className="btn danger" onClick={() => invoke("skills_update_stop")} disabled={status?.state === "stopping"}>
                  {STOP_LABEL}
                </button>
              ) : null}
              <button className="btn primary" onClick={start} disabled={busy || (checked?.report.available ?? 0) === 0}>
                {busy ? UPDATING_LABEL : UPDATE_LABEL}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
