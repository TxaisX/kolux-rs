// TERM-045: the one question before a tab with a live program closes. Enter (the focused Close
// button) confirms, Escape or Cancel keeps the tab.
export default function CloseAsk({ title, body, onConfirm, onCancel }: { title: string; body: string; onConfirm: () => void; onCancel: () => void }) {
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
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn danger" autoFocus onClick={onConfirm}>
            Close tab
          </button>
        </div>
      </div>
    </div>
  );
}
