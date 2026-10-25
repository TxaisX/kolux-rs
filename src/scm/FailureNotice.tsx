// GIT-009 / VIEW-066: the notice a failed Source Control action leaves; split from the panel so its
// Pull first and Dismiss buttons can be rendered and clicked in a test without a back end.
import { failureSummary } from "./rules";
import { PULL_POLICIES, type RemoteAction } from "./model";

export type Failure = { title: string; output: string; fix?: string | null; policy?: boolean; behind?: boolean };

type Props = {
  failure: Failure;
  busy: boolean;
  /** The Fix with AI button shows only when the AI features are on for this repository. */
  aiOn: boolean;
  onRemote: (action: RemoteAction, label: string) => void;
  onCopy: (text: string, what: string) => void;
  onFix: (output: string) => void;
  onDismiss: () => void;
};

export default function FailureNotice({ failure, busy, aiOn, onRemote, onCopy, onFix, onDismiss }: Props) {
  const summary = failureSummary(failure.output);
  return (
    <div className="scm-out" role="alert">
      <details>
        <summary>{failure.title}</summary>
        <p data-failure-summary>{summary.summary}</p>
        {summary.details && <pre>{failure.output || "git gave no reason"}</pre>}
      </details>
      {failure.policy && (
        <div className="scm-policy" data-pull-policy style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div>Pick how to bring the remote's commits in; the pull runs again with it.</div>
          {PULL_POLICIES.map((p) => (
            <div key={p.action} className="btn-row">
              <button className="btn" disabled={busy} title={p.title} data-policy={p.action} onClick={() => onRemote(p.action, `Pull (${p.label.toLowerCase()})`)}>
                {p.label}
              </button>
              <button className="btn ghost" title={`Copies "${p.config}" to set this for good; nothing changes until you run it`} data-policy-copy={p.action} onClick={() => onCopy(p.config, "git config command")}>
                Copy setting
              </button>
            </div>
          ))}
        </div>
      )}
      {failure.behind && (
        <button className="btn" disabled={busy} title="The remote has commits this copy lacks; bring them in, then push again" data-pull-first onClick={() => onRemote("pull", "Pull")}>
          Pull first
        </button>
      )}
      {aiOn && failure.fix !== null && !failure.policy && (
        <button className="btn" data-fix-failure onClick={() => onFix(failure.fix ?? failure.output)}>
          Fix with AI
        </button>
      )}
      <button className="btn ghost" data-dismiss-failure onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
