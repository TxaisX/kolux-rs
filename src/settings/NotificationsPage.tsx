// Settings > Notifications (SET-034): which kinds of event may notify, the sound and its volume,
// a test button that shows a sample notification with that sound, and a link to the system's own
// notification settings (offered prominently when the system has notifications switched off).
// USAGE-009: the usage-alerts preference, on by default (shown in the same view).
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { AUDIO_TYPES, audioTypeAllowed, CLOSE_TO_TRAY_FIELD, CUSTOM_FIELD, KINDS, loadSound, preparePlan, readNotifications, SOUND_FIELD, SOUNDS, SUPPRESS_FOCUSED_FIELD, VOLUME_FIELD, type Sound } from "./notifications";
import { ALERTS_FIELD, alertsOn } from "../usage/alerts";
import { useSettings } from "./useSettings";

type Result = { shown: boolean; blocked: boolean };

export function NotificationsView({ settings, onSave }: { settings: Record<string, unknown>; onSave: (patch: Record<string, unknown>) => void }) {
  const n = readNotifications(settings);
  const [result, setResult] = useState<Result | { error: string } | null>(null);
  const openSystem = () => invoke("open_notification_settings").catch((e) => setResult({ error: String(e) }));
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const test = () => {
    void preparePlan(n).then(({ plan, play, close, problem }) => {
      setFileProblem(problem);
      return invoke<Result>("notification_test", { sound: plan.toastSound })
        .then((r) => {
          setResult(r);
          if (r.shown) play();
        })
        .catch((e) => {
          close();
          setResult({ error: String(e) });
        });
    });
  };
  // STAT-043: a custom sound must be an allowed audio type; the file is read once here so a bad one
  // is refused with a reason instead of being saved and failing silently later.
  const choose = async () => {
    const picked = await open({ multiple: false, directory: false, filters: [{ name: "Audio", extensions: [...AUDIO_TYPES] }] }).catch(() => null);
    if (typeof picked !== "string") return;
    if (!audioTypeAllowed(picked)) return setFileProblem(`That file is not an allowed sound type (${AUDIO_TYPES.join(", ")}).`);
    try {
      (await loadSound(picked, 1)).close();
    } catch (e) {
      return setFileProblem(`That file cannot be used as a sound: ${String(e)}`);
    }
    setFileProblem(null);
    onSave({ [CUSTOM_FIELD]: picked, [SOUND_FIELD]: "custom" });
  };
  const fileName = n.customFile?.split(/[\\/]/).pop() ?? null;
  return (
    <>
      <section className="conn-card" data-section="kinds">
        <h2 className="conn-name">What notifies you</h2>
        {KINDS.map((k) => (
          <label key={k.key} className="conn-switch">
            <input type="checkbox" role="switch" checked={n.kinds[k.key]} onChange={(e) => onSave({ [k.key]: e.target.checked })} />
            {k.label}
          </label>
        ))}
        <label className="conn-switch">
          <input type="checkbox" role="switch" checked={n.suppressFocused} onChange={(e) => onSave({ [SUPPRESS_FOCUSED_FIELD]: e.target.checked })} />
          <span>
            Stay quiet about the worktree you are looking at
            <small>Events in the worktree that has focus are not announced.</small>
          </span>
        </label>
        <label className="conn-switch">
          <input type="checkbox" role="switch" checked={n.closeToTray} onChange={(e) => onSave({ [CLOSE_TO_TRAY_FIELD]: e.target.checked })} />
          <span>
            Closing the window keeps Kolux in the tray
            <small>Windows only. The agents keep running; Quit from the tray icon stops everything.</small>
          </span>
        </label>
      </section>
      <section className="conn-card" data-section="sound">
        <h2 className="conn-name">Sound</h2>
        <div className="look-select">
          <span>Sound</span>
          <select aria-label="Notification sound" value={n.sound} onChange={(e) => onSave({ [SOUND_FIELD]: e.target.value as Sound })}>
            {SOUNDS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        {n.sound === "custom" && (
          <div className="look-select">
            <span>Custom file</span>
            <span className="notif-volume">
              <output>{fileName ?? "No file chosen: the system sound plays"}</output>
              <button className="btn" onClick={() => void choose()}>
                Choose a sound file
              </button>
            </span>
          </div>
        )}
        {fileProblem && (
          <p className="conn-detail warn" role="alert">
            {fileProblem}
          </p>
        )}
        <div className="look-select">
          <span>Volume</span>
          <span className="notif-volume">
            <input type="range" min={0} max={100} step={5} aria-label="Volume" value={n.volume} onChange={(e) => onSave({ [VOLUME_FIELD]: Number(e.target.value) })} />
            <output>{n.volume === 0 ? "Silent" : `${n.volume}%`}</output>
          </span>
        </div>
        <p className="conn-detail">The volume covers every sound Kolux plays. The system default sound plays at the system's own volume, and not at all at 0.</p>
        <div className="btn-row">
          <button className="btn" onClick={test}>
            Send a test notification
          </button>
          <button className="btn link" onClick={() => void openSystem()}>
            System notification settings
          </button>
        </div>
        {result && "error" in result && <p className="conn-detail warn">The test notification could not be shown: {result.error}</p>}
        {result && "blocked" in result && result.blocked && (
          <p className="conn-detail warn" role="alert">
            Notifications are switched off for apps in your system settings, so nothing can be shown. Turn them on in System notification settings.
          </p>
        )}
        {result && "shown" in result && result.shown && (
          <p className="conn-detail" role="status">
            Test sent{n.volume === 0 ? " in silence" : ""}. If it did not appear, check System notification settings.
          </p>
        )}
      </section>
      <section className="conn-card" data-section="usage-alerts">
        <h2 className="conn-name">Usage alerts</h2>
        <label className="conn-switch">
          <input type="checkbox" role="switch" checked={alertsOn(settings)} onChange={(e) => onSave({ [ALERTS_FIELD]: e.target.checked })} />
          Tell me when an account reaches 80% and 95% of a usage window
        </label>
        <p className="conn-detail">Each alert comes once per window and again only after that window resets.</p>
      </section>
    </>
  );
}

export default function NotificationsPage() {
  const { settings, error, save } = useSettings();
  return (
    <>
      {error && <p className="conn-detail warn">{error}</p>}
      {settings && <NotificationsView settings={settings} onSave={save} />}
    </>
  );
}
