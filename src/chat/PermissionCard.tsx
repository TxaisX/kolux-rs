// Native chat, the permission card (CHAT-023; T-329): "Allow Bash?" with Allow and Deny, and Review
// plan when the request is to leave plan mode. The rules are in ask.ts.
import { askTitle, type Card } from "./ask";

export function PermissionCard({ card, onAllow, onDeny, onReview, onDismiss }: { card: Card; onAllow: () => void; onDeny: () => void; onReview?: () => void; onDismiss: () => void }) {
  return (
    <div className="chat-permission" role="alertdialog" aria-label={askTitle(card.tool)}>
      <div className="chat-permission-head">
        <strong>{askTitle(card.tool)}</strong>
        <button type="button" className="chat-permission-x" aria-label="Dismiss" title="Dismiss (answer in the terminal)" onClick={onDismiss}>
          ×
        </button>
      </div>
      {card.detail && <pre className="chat-permission-detail">{card.detail}</pre>}
      <div className="chat-permission-actions">
        <button type="button" className="allow" onClick={onAllow}>Allow</button>
        <button type="button" className="deny" onClick={onDeny}>Deny</button>
        {card.review && onReview && <button type="button" onClick={onReview}>Review plan</button>}
      </div>
      {card.review && !onReview && card.plan && (
        <details>
          <summary>Review plan</summary>
          <pre className="chat-permission-plan">{card.plan}</pre>
          {card.planCut && <div>The plan was cut short. See the terminal for the rest.</div>}
        </details>
      )}
    </div>
  );
}
