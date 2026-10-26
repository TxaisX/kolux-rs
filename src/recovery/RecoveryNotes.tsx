// After-list row 789: the one notice that names what startup recovery set aside or restored.

export default function RecoveryNotes({ notes, onDismiss }: { notes: string[]; onDismiss: () => void }) {
  if (notes.length === 0) return null;
  return (
    <div className="notice recovery-notes" role="status" aria-label="Recovered at start" style={{ flexWrap: "wrap" }}>
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {notes.map((n) => (
          <span key={n}>{n}</span>
        ))}
      </span>
      <button className="ib" onClick={onDismiss} title="Dismiss">
        ×
      </button>
    </div>
  );
}
