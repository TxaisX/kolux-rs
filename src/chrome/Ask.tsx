// VIEW-116: the one confirmation dialog. Cancel holds focus when it opens, so a stray Enter backs
// out; Enter confirms only on prompts that opt in (`enter`) and only while Confirm has focus;
// Escape always cancels. The don't-ask-again tick lives in this dialog alone: it is handed over
// only with a confirm, and the next prompt (a new dialog) starts unticked.
import { useEffect, useRef, useState, type ReactNode } from "react";

/** What a key press in the dialog does: Escape cancels; Enter on Confirm is blocked unless the
 * prompt opts in; anything else (Enter on Cancel included) does what the focused control does. */
export const askKey = (key: string, onConfirm: boolean, enter: boolean): "cancel" | "block" | "pass" => (key === "Escape" ? "cancel" : key === "Enter" && onConfirm && !enter ? "block" : "pass");

type Props = {
  title: string;
  body: ReactNode;
  /** The confirm button's word, e.g. Delete. */
  confirm: string;
  /** Lets Enter confirm while the confirm button has focus. */
  enter?: boolean;
  /** Offers a don't-ask-again box; its tick reaches `onConfirm` and nowhere else. */
  dontAsk?: boolean;
  onConfirm: (dontAskAgain: boolean) => void;
  onCancel: () => void;
};

export default function Ask({ title, body, confirm, enter = false, dontAsk = false, onConfirm, onCancel }: Props) {
  const [tick, setTick] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  return (
    <div className="ask-backdrop" onMouseDown={onCancel}>
      <div
        className="ask"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          const what = askKey(e.key, e.target === ok.current, enter);
          if (what !== "pass") e.preventDefault();
          if (what === "cancel") onCancel();
        }}
      >
        <h2 className="ask-title">{title}</h2>
        <div className="ask-body">{body}</div>
        {dontAsk && (
          <label className="check ask-check">
            <input type="checkbox" checked={tick} onChange={(e) => setTick(e.target.checked)} /> Don&apos;t ask again
          </label>
        )}
        <div className="btn-row">
          <button ref={cancel} className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button ref={ok} className="btn danger" onClick={() => onConfirm(tick)}>
            {confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
