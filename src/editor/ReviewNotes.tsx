// GIT-042: the note popover beside the selection and the tray that keeps the notes until they are
// copied as one Markdown block.
import { useState } from "react";
import { Close } from "../chrome/icons";
import { baseName } from "./buffers";
import { notesMarkdown, type Note, type Picked } from "./notes";

type Props = { picked: Picked | null; notes: Note[]; onAdd: (n: Note) => void; onCancel: () => void; onRemove: (i: number) => void; onClear: () => void };

export default function ReviewNotes({ picked, notes, onAdd, onCancel, onRemove, onClear }: Props) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const add = () => {
    if (!picked || !text.trim()) return;
    onAdd({ ...picked.draft, note: text, time: Date.now() });
    setText("");
  };
  const copy = () =>
    navigator.clipboard.writeText(notesMarkdown(notes)).then(
      () => setSaid("Copied the notes as Markdown"),
      () => setSaid("Could not copy; select the text below instead"),
    );
  return (
    <>
      {picked && (
        <div className="review-pop" role="dialog" aria-label="Add review note" style={{ left: Math.min(picked.x, window.innerWidth - 340), top: Math.min(picked.y + 6, window.innerHeight - 220) }}>
          <div className="review-where">
            {baseName(picked.draft.path)} line {picked.draft.line}
          </div>
          <blockquote className="review-quote">{picked.draft.quote}</blockquote>
          <textarea
            className="field multi"
            aria-label="review note"
            placeholder="Note for the agent"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onCancel();
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) add();
            }}
          />
          <div className="btn-row">
            <button className="btn primary" data-note-add disabled={!text.trim()} onClick={add}>
              Add note
            </button>
            <button className="btn" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {notes.length > 0 && (
        <div className="review-tray" role="region" aria-label="Review notes">
          <div className="review-head">
            <button className="review-count" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {notes.length === 1 ? "1 review note" : `${notes.length} review notes`}
            </button>
            <button className="btn" data-notes-copy onClick={() => void copy()}>
              Copy as Markdown
            </button>
            <button className="ib" title="Clear the notes" onClick={onClear}>
              <Close size={12} />
            </button>
          </div>
          {said && <div className="sb-hint">{said}</div>}
          {open && <pre className="review-md" data-notes-markdown>{notesMarkdown(notes)}</pre>}
          {open &&
            notes.map((n, i) => (
              <div key={n.time + n.path + i} className="review-row">
                <span className="where">
                  {baseName(n.path)}:{n.line}
                </span>
                <span className="txt">{n.note}</span>
                <button className="ib" title="Remove this note" onClick={() => onRemove(i)}>
                  <Close size={10} />
                </button>
              </div>
            ))}
        </div>
      )}
    </>
  );
}
