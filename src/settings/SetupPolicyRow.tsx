// T-294-c / PROJ-035: the global setup choice, the value a repository's "Same as everywhere" names.
import { SETUP_POLICY_KEY, globalChoice, globalOptions } from "./setupChoice";

type Props = { settings: Record<string, unknown>; save: (patch: Record<string, unknown>) => unknown };

export default function SetupPolicyRow({ settings, save }: Props) {
  const now = globalChoice(settings[SETUP_POLICY_KEY]);
  return (
    <section className="conn-card" data-section="setup-policy">
      <h2 className="conn-name">Workspace setup</h2>
      <div className="look-select">
        <span>Which setup runs</span>
        <select aria-label="which setup runs" className="field" value={now} onChange={(e) => void save({ [SETUP_POLICY_KEY]: e.target.value })}>
          {globalOptions().map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <p className="conn-detail">For every repository that has not chosen its own, on its page under Settings. A script from kolux.yaml still asks before it first runs.</p>
    </section>
  );
}
