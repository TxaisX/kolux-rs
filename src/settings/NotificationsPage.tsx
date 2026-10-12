// Settings > Notifications. USAGE-009: the usage-alerts preference, on by default. The master
// notifications switch and the agent notifications come with T-026.
import { ALERTS_FIELD, alertsOn } from "../usage/alerts";
import { useSettings } from "./useSettings";

export default function NotificationsPage() {
  const { settings, error, save } = useSettings();
  return (
    <>
      {error && <p className="conn-detail warn">{error}</p>}
      {settings && (
        <section className="conn-card" data-section="usage-alerts">
          <h2 className="conn-name">Usage alerts</h2>
          <label className="conn-switch">
            <input type="checkbox" role="switch" checked={alertsOn(settings)} onChange={(e) => save({ [ALERTS_FIELD]: e.target.checked })} />
            Tell me when an account reaches 80% and 95% of a usage window
          </label>
          <p className="conn-detail">Each alert comes once per window and again only after that window resets.</p>
        </section>
      )}
    </>
  );
}
