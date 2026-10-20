// T-124-b (STAT-035 rest): the 'Auto-generate tab titles' switch on Settings > Agents, off by
// default. It saves the key src/shell/tabTitle.ts reads (T-258), so the switch is never a dead
// control. Rendered by AgentsPage (evidence/hooks-T-124-b-AgentsPage.tsx.patch).
import { GENERATED_TITLES_FIELD, generatedOn } from "../shell/tabTitle";

export function GeneratedTitlesCard({ settings, save }: { settings: Record<string, unknown> | null; save: (patch: Record<string, unknown>) => unknown }) {
  return (
    <section className="conn-card" aria-label="Tab titles">
      <label className="conn-switch">
        <input type="checkbox" role="switch" checked={generatedOn(settings ?? {})} onChange={(e) => void save({ [GENERATED_TITLES_FIELD]: e.target.checked })} />
        <span>
          Auto-generate tab titles
          <small>Tabs without a name of their own get a short one drawn from the task, or the agent and its branch. A name you type always wins.</small>
        </span>
      </label>
    </section>
  );
}
