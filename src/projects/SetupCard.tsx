// PROJ-035: the small card above the sidebar toolbar that offers to set up a setup script.
import { cardView, skippedLine, type SetupSuggestion } from "./setupSuggestion";

export function SetupCard({ project, suggestion, busy, onSave, onDismiss, onRetry }: { project: string; suggestion: SetupSuggestion; busy: boolean; onSave: (from: string) => void; onDismiss: () => void; onRetry: () => void }) {
  const v = cardView(suggestion, project);
  if (!v) return null;
  return (
    <div className="sb-form" data-setup-card={suggestion.kind} role="region" aria-label="Setup script suggestion">
      <label>{v.title}</label>
      <div className="hint">{v.body}</div>
      {v.script && <pre className="import-script">{v.script}</pre>}
      {skippedLine(v.skipped) && <div className="hint">{skippedLine(v.skipped)}</div>}
      <div className="btn-row">
        {v.saveFrom && (
          <button className="btn primary" disabled={busy} onClick={() => onSave(v.saveFrom!)}>
            {v.saveLabel}
          </button>
        )}
        {v.retry && (
          <button className="btn" disabled={busy} onClick={onRetry}>
            Retry
          </button>
        )}
        <button className="btn" disabled={busy} onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
