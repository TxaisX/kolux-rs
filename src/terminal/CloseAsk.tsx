import type { ReactNode } from "react";

// TERM-045: the one question before a tab with a live program closes. Enter (the focused Close
// button) confirms, Escape or Cancel keeps the tab. GIT-003 reuses it with its own button label
// and a list between the body and the buttons; the list scrolls on its own, the buttons stay put.
export default function CloseAsk({ title, body, confirm = "Close tab", children, onConfirm, onCancel }: { title: string; body: string; confirm?: string; children?: ReactNode; onConfirm: () => void; onCancel: () => void }) {
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
        {children}
        <div className="btn-row">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn danger" autoFocus onClick={onConfirm}>
            {confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
