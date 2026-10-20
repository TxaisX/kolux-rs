// VIEW-072: a clear button for review notes that asks before it removes two or more of them.
import { useState, type ReactNode } from "react";
import { clearQuestion, needsConfirm } from "./clearNotes";

type Props = { count: number; where?: string; className?: string; title?: string; ariaLabel?: string; children: ReactNode; onConfirm: () => void };

export default function ConfirmClear({ count, where, className = "btn", title, ariaLabel, children, onConfirm }: Props) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button className={className} title={title} aria-label={ariaLabel} onClick={() => (needsConfirm(count) ? setAsking(true) : onConfirm())}>
        {children}
      </button>
    );
  return (
    <span className="confirm-clear" role="group" aria-label="Confirm clearing notes" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setAsking(false))}>
      <span className="confirm-q">{clearQuestion(count, where)}</span>
      <button className="btn" autoFocus onClick={() => (setAsking(false), onConfirm())}>
        Clear
      </button>
      <button className="btn" onClick={() => setAsking(false)}>
        Keep
      </button>
    </span>
  );
}
