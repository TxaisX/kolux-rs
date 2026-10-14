// Settings > Notifications: the quiet-alert minutes (STAT-045, 10 by default, 0 off). The kinds'
// switches (STAT-041, STAT-023) are KINDS in notifications.ts. A plain settings key; the importer
// task carries the old app's saved choice into it.
import { numberOrDefault, useDraft, useSettings } from "./useSettings";

export const QUIET_FIELD = "quietMinutes";
const QUIET_DEFAULT = 10;

export default function Notifications() {
  const { settings, save } = useSettings();
  const minutes = typeof settings?.[QUIET_FIELD] === "number" ? (settings[QUIET_FIELD] as number) : QUIET_DEFAULT;
  // SET-036: typed minutes save after a pause or on leaving; emptied, they go back to the default.
  const quiet = useDraft(String(minutes), (t) => save({ [QUIET_FIELD]: numberOrDefault(t, QUIET_DEFAULT, [0, 600]) }));
  if (!settings) return null;
  return (
    <section className="conn-card" aria-label="Notifications">
      <label className="conn-switch">
        <input type="number" min={0} max={600} step={1} aria-label="Quiet alert minutes" {...quiet} />
        <span>
          Quiet alert after this many minutes
          <small>One notification when a working agent prints nothing for that long. 0 turns it off.</small>
        </span>
      </label>
    </section>
  );
}
