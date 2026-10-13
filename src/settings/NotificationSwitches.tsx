// Settings > Notifications: the quiet-alert minutes (STAT-045, 10 by default, 0 off). The kinds'
// switches (STAT-041, STAT-023) are KINDS in notifications.ts. A plain settings key; the importer
// task carries the old app's saved choice into it.
import { useSettings } from "./useSettings";

export const QUIET_FIELD = "quietMinutes";

export default function Notifications() {
  const { settings, save } = useSettings();
  if (!settings) return null;
  const minutes = typeof settings[QUIET_FIELD] === "number" ? (settings[QUIET_FIELD] as number) : 10;
  return (
    <section className="conn-card" aria-label="Notifications">
      <label className="conn-switch">
        <input type="number" min={0} max={600} step={1} value={minutes} aria-label="Quiet alert minutes" onChange={(e) => save({ [QUIET_FIELD]: Math.max(0, Math.floor(Number(e.target.value)) || 0) })} />
        <span>
          Quiet alert after this many minutes
          <small>One notification when a working agent prints nothing for that long. 0 turns it off.</small>
        </span>
      </label>
    </section>
  );
}
