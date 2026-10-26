// PROJ-084: add, rename, reorder and remove the statuses; opened from Move to status.
import { useState } from "react";
import { addRow, canSave, moveRow, removeRow, renameRow, type StatusRow } from "./statusEditor";

export default function StatusEditor({ initial, error, onSave, onCancel }: { initial: StatusRow[]; error?: string; onSave: (rows: StatusRow[]) => void; onCancel: () => void }) {
  const [rows, setRows] = useState(initial);
  return (
    <div className="sb-form" data-status-editor>
      {rows.map((r, i) => (
        <div className="btn-row" key={r.id ?? `new-${i}`}>
          <input className="field" aria-label={`Status ${i + 1}`} placeholder="Status name" value={r.label} onChange={(e) => setRows(renameRow(rows, i, e.target.value))} />
          <button className="btn" aria-label={`Move ${r.label || "status"} up`} disabled={i === 0} onClick={() => setRows(moveRow(rows, i, -1))}>
            Up
          </button>
          <button className="btn" aria-label={`Move ${r.label || "status"} down`} disabled={i === rows.length - 1} onClick={() => setRows(moveRow(rows, i, 1))}>
            Down
          </button>
          <button className="btn" aria-label={`Remove ${r.label || "status"}`} disabled={rows.length === 1} onClick={() => setRows(removeRow(rows, i))}>
            Remove
          </button>
        </div>
      ))}
      {error && (
        <span className="note error" role="alert">
          {error}
        </span>
      )}
      <div className="btn-row">
        <button className="btn" onClick={() => setRows(addRow(rows))}>
          Add status
        </button>
        <button className="btn" disabled={!canSave(rows)} onClick={() => onSave(rows)}>
          Save
        </button>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
