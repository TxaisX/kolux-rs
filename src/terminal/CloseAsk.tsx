// TERM-045: the one question before a tab with a live program closes. Enter (the focused Close
// button) confirms, Escape or Cancel keeps the tab. ACCT-015's Disconnect asks the same way, and
// with `confirm` null it only explains, with a single OK.
/** What a Disconnect asks first; `confirm` null means it only explains (ACCT-015). */
export type Ask = { title: string; body: string; confirm: string | null };

export default function CloseAsk({ title, body, onConfirm, onCancel, confirm = "Close tab" }: { title: string; body: string; onConfirm: () => void; onCancel: () => void; confirm?: string | null }) {
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
          if (e.key === "Escape") onCancel();
        }}
      >
        <h2 className="ask-title">{title}</h2>
        <p className="ask-body">{body}</p>
        <div className="btn-row">
          {confirm === null ? (
            <button className="btn primary" autoFocus onClick={onCancel}>
              OK
            </button>
          ) : (
            <>
              <button className="btn" onClick={onCancel}>
                Cancel
              </button>
              <button className="btn danger" autoFocus onClick={onConfirm}>
                {confirm}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
