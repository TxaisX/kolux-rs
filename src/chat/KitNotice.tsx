// Council FIX-3 (FIX-BEFORE 1 of chat e5412ff): the kit strip's line for a role whose prompt is
// waiting and why, with Send prompt (when sending is the user's call and no paste of it is under
// way, FIX-SOON 1) and Copy prompt.
import type { KitWait } from "../kits/useKits";
import "./chat.css";
import { kitNotices } from "./kitPrompt";

export function KitPromptNotices({ waiting, onSend, onCopy }: { waiting: readonly KitWait[]; onSend: (w: KitWait) => void; onCopy: (w: KitWait) => void }) {
  const list = kitNotices(waiting);
  if (list.length === 0) return null;
  return (
    <div className="kit-prompt-notices" role="status">
      {list.map(({ wait, notice, inFlight }) => (
        <div key={`${wait.key}-${wait.role}`} className={`kit-prompt-notice ${notice.kind}`}>
          <span className="kit-prompt-text">{notice.text}</span>
          {notice.canSend && !inFlight && (
            <button type="button" onClick={() => onSend(wait)}>
              Send prompt
            </button>
          )}
          <button type="button" onClick={() => onCopy(wait)}>
            Copy prompt
          </button>
        </div>
      ))}
    </div>
  );
}
