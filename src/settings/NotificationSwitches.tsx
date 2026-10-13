// Settings > Notifications: the keys of the 'Agent Task Complete' (STAT-041) and 'Agent Stopped'
// (STAT-023) kinds, whose switches are in the page's kinds list, and the quiet-alert minutes
// (STAT-045, 10 by default, 0 off). All plain settings keys; the importer task carries the old
// app's saved choices into them.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export const FINISH_FIELD = "notifyOnFinish";
export const STOPPED_FIELD = "notifyOnStopped";
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
  const minutes = typeof settings[QUIET_FIELD] === "number" ? (settings[QUIET_FIELD] as number) : 10;
  return (
    <section className="conn-card" aria-label="Notifications">
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
