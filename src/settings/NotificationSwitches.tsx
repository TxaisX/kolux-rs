// Settings > Notifications: the 'Agent Task Complete' switch (STAT-041, on by default), the
// 'Agent Stopped' switch (STAT-023, on by default) and the quiet-alert minutes (STAT-045, 10 by
// default, 0 off). All plain settings keys; the importer task carries the old app's saved choices
// into them.
import { numberOrDefault, useDraft, useSettings } from "./useSettings";

export const FINISH_FIELD = "notifyOnFinish";
export const STOPPED_FIELD = "notifyOnStopped";
export const QUIET_FIELD = "quietMinutes";
const QUIET_DEFAULT = 10;

export default function Notifications() {
  // Laid over the stored settings (SET-035) so a switch elsewhere on the page is never undone, and
  // read again whenever any window saves.
  const { settings, save: write } = useSettings();
  const save = (key: string, value: unknown) => write({ [key]: value });
  const minutes = typeof settings?.[QUIET_FIELD] === "number" ? (settings[QUIET_FIELD] as number) : QUIET_DEFAULT;
  // SET-036: typed minutes save after a pause or on leaving; emptied, they go back to the default.
  const quiet = useDraft(String(minutes), (t) => save(QUIET_FIELD, numberOrDefault(t, QUIET_DEFAULT, [0, 600])));
  if (!settings) return null;
  const on = settings[FINISH_FIELD] !== false;
  const stopped = settings[STOPPED_FIELD] !== false;
  return (
    <section className="conn-card" aria-label="Notifications">
      <label className="conn-switch">
        <input type="checkbox" role="switch" checked={on} onChange={(e) => save(FINISH_FIELD, e.target.checked)} />
        <span>
          Agent Task Complete
          <small>A desktop notification when an agent finishes or needs permission while you are looking elsewhere.</small>
        </span>
      </label>
      <label className="conn-switch">
        <input type="checkbox" role="switch" checked={stopped} onChange={(e) => save(STOPPED_FIELD, e.target.checked)} />
        <span>
          Agent Stopped
          <small>One notification when an agent halts on a usage limit, a lapsed sign-in or a provider error, saying why and when the limit lifts.</small>
        </span>
      </label>
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
