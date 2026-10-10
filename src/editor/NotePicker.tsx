// Mod+Shift+O (EDIT-012): pick one of the worktree's markdown files to open. The list is asked for
// afresh each time the picker opens, so a failed listing is tried again rather than remembered.
// Ignored files and symlinked folders are left out and the list is capped (md_list in files.rs).
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Props = { root: string; onPick: (path: string) => void; onClose: () => void };

const SHOWN = 200;

export default function NotePicker({ root, onPick, onClose }: Props) {
  const [notes, setNotes] = useState<{ files: string[]; capped: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [at, setAt] = useState(0);

  useEffect(() => {
    invoke<{ files: string[]; capped: boolean }>("md_list", { root }).then(setNotes, (err) => setError(String(err)));
  }, [root]);

  const rel = (f: string) => f.slice(root.length).replace(/^[\\/]+/, "");
  const hits = useMemo(() => {
    const q = filter.toLowerCase();
    return (notes?.files ?? []).filter((f) => rel(f).toLowerCase().includes(q)).slice(0, SHOWN);
  }, [notes, filter]);
  const pick = (f: string | undefined) => {
    if (!f) return;
    onClose();
    onPick(f);
  };

  return (
    <>
      <div className="menu-backdrop" onMouseDown={onClose} />
      <div className="menu note-picker" role="dialog" aria-label="Open a markdown file">
        <input
          autoFocus
          className="picker-input"
          placeholder="Open a markdown file"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setAt(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "Enter") pick(hits[at]);
            else if (e.key === "ArrowDown") setAt((i) => Math.min(i + 1, hits.length - 1));
            else if (e.key === "ArrowUp") setAt((i) => Math.max(i - 1, 0));
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
        />
        <div className="picker-list" role="listbox">
          {error && <div className="menu-hint">Could not list the markdown files: {error}. Open the picker again to retry.</div>}
          {!error && !notes && <div className="menu-hint">Listing markdown files…</div>}
          {notes && hits.length === 0 && <div className="menu-hint">{notes.files.length ? "No markdown file matches." : "This worktree has no markdown files."}</div>}
          {hits.map((f, i) => (
            <button key={f} role="option" aria-selected={i === at} className={`menu-item${i === at ? " at" : ""}`} onMouseEnter={() => setAt(i)} onClick={() => pick(f)} title={f}>
              <span className="name">{rel(f)}</span>
            </button>
          ))}
          {notes?.capped && <div className="menu-hint">Only the first {notes.files.length} markdown files are listed; this worktree has more.</div>}
        </div>
      </div>
    </>
  );
}
