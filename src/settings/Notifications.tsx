// Settings > Notifications: the 'Agent Task Complete' switch (STAT-041, on by default) and the
// quiet-alert minutes (STAT-045, 10 by default, 0 off). Both are plain settings keys; the importer
// task carries the old app's saved choices into them.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export const FINISH_FIELD = "notifyOnFinish";
export const QUIET_FIELD = "quietMinutes";

export default function Notifications() {
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    invoke<Record<string, unknown>>("get_settings").then(setSettings).catch(() => setSettings({}));
  }, []);
  // Saved over a fresh read so a switch elsewhere on the page is never undone by a stale copy.
  const save = (key: string, value: unknown) => {
    setSettings((s) => ({ ...(s ?? {}), [key]: value }));
    invoke<Record<string, unknown>>("get_settings")
      .then((s) => invoke("save_settings", { value: { ...s, [key]: value } }))
      .catch(() => {});
  };
  if (!settings) return null;
  const on = settings[FINISH_FIELD] !== false;
  const minutes = typeof settings[QUIET_FIELD] === "number" ? (settings[QUIET_FIELD] as number) : 10;
  return (
    <section className="conn-card" aria-label="Notifications">
      <label className="conn-switch">
        <input type="checkbox" role="switch" checked={on} onChange={(e) => save(FINISH_FIELD, e.target.checked)} />
        <span>
          Agent Task Complete
          <small>A desktop notification when an agent finishes, needs permission or is blocked while you are looking elsewhere.</small>
        </span>
      </label>
      <label className="conn-switch">
        <input type="number" min={0} max={600} step={1} value={minutes} aria-label="Quiet alert minutes" onChange={(e) => save(QUIET_FIELD, Math.max(0, Math.floor(Number(e.target.value)) || 0))} />
        <span>
          Quiet alert after this many minutes
          <small>One notification when a working agent prints nothing for that long. 0 turns it off.</small>
        </span>
      </label>
    </section>
  );
}
