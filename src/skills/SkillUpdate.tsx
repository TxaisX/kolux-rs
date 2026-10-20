// SKILL-024: the notice that some Kolux skills installed outside Kolux are out of date.
// SKILL-026: the background update dialog: what qualifies, why the rest is kept (with a reinstall
// command), Update, Stop, the per-skill result, and Show log with the installer's output.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Close } from "../chrome/icons";
import SkillInstall from "./SkillInstall";
import { STOP_LABEL, UPDATE_LABEL, UPDATING_LABEL, chipTone, freshKeys, noticeShown, noticeText, sumUpRun, updatable, type Checked, type UpdateStatus } from "./updateNotice";

/** One notice per session, dismissed or not. */
let shownThisSession = false;

type Props = { workspace: string | null; settingsLoaded?: boolean; onChanged?: () => void; /** The Kolux skills the Install panel offers. */ bundled?: string[]; /** Types a command into the inline terminal without running it (T-244-b). */ onType?: (line: string) => void };

export default function SkillUpdate({ workspace, settingsLoaded = true, onChanged, bundled = [], onType }: Props) {
  const [checked, setChecked] = useState<Checked | null>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState(false);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [log, setLog] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const check = () => invoke<Checked>("skills_update_check", { workspace }).then(setChecked, () => setChecked(null));
  useEffect(() => void check(), [workspace]);
  useEffect(() => {
    if (!shownThisSession && noticeShown(checked, settingsLoaded, false)) {
      shownThisSession = true;
      setNotice(true);
    }
  }, [checked, settingsLoaded]);
  useEffect(() => () => clearInterval(timer.current), []);

  const poll = () => {
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      invoke<UpdateStatus>("skills_update_status").then((s) => {
        setStatus(s);
        if (s.state === "done") {
          clearInterval(timer.current);
          check();
          onChanged?.();
        }
      }, () => clearInterval(timer.current));
    }, 500);
  };

  const dismiss = () => {
    setNotice(false);
    if (checked) invoke("skills_update_dismiss", { keys: freshKeys(checked) }).catch(() => undefined);
  };
  const busy = status?.state === "running" || status?.state === "stopping";
  const start = () => {
    if (!checked) return;
    setErr(null);
    setLog(false);
    invoke("skills_update_clear")
      .then(() => invoke("skills_update_start", { workspace, names: updatable(checked.report) }))
      .then(() => (setStatus({ state: "running", names: [], command: "", log: "", code: null, stopped: false, error: null, results: [] }), poll()))
      .catch((e) => setErr(String(e)));
  };
  const close = () => {
    if (busy) return;
    setOpen(false);
    if (status?.state === "done") invoke("skills_update_clear").catch(() => undefined);
    setStatus(null);
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
              <button className="btn" onClick={close} disabled={busy}>
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
