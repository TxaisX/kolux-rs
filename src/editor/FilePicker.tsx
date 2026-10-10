// A picker over files of the worktree: Mod+Shift+O's markdown files (EDIT-012) and the New tab
// menu's changed files (EDIT-027). The list is asked for afresh each time the picker opens, so a
// failed listing is tried again rather than remembered.
import { useEffect, useMemo, useState } from "react";

export type Pick = { path: string; tag?: string; staged?: boolean };
type Props = { root: string; what: string; load: () => Promise<{ items: Pick[]; capped: boolean }>; onPick: (item: Pick) => void; onClose: () => void };

const SHOWN = 200;

export default function FilePicker({ root, what, load, onPick, onClose }: Props) {
  const [list, setList] = useState<{ items: Pick[]; capped: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [at, setAt] = useState(0);

  useEffect(() => {
    load().then(setList, (err) => setError(String(err)));
  }, [root]);

  const rel = (f: string) => f.slice(root.length).replace(/^[\\/]+/, "");
  const hits = useMemo(() => {
    const q = filter.toLowerCase();
    return (list?.items ?? []).filter((f) => rel(f.path).toLowerCase().includes(q)).slice(0, SHOWN);
  }, [list, filter]);
  const pick = (f: Pick | undefined) => {
    if (!f) return;
    onClose();
    onPick(f);
  };

  return (
    <>
      <div className="menu-backdrop" onMouseDown={onClose} />
      <div className="menu note-picker" role="dialog" aria-label={`Open a ${what}`}>
        <input
          autoFocus
          className="picker-input"
          placeholder={`Open a ${what}`}
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
          {error && <div className="menu-hint">Could not list them: {error}. Open the picker again to retry.</div>}
          {!error && !list && <div className="menu-hint">Listing…</div>}
          {list && hits.length === 0 && <div className="menu-hint">{list.items.length ? "Nothing matches." : `This worktree has no ${what}s.`}</div>}
          {hits.map((f, i) => (
            <button key={`${f.path}|${f.tag ?? ""}`} role="option" aria-selected={i === at} className={`menu-item${i === at ? " at" : ""}`} onMouseEnter={() => setAt(i)} onClick={() => pick(f)} title={f.path}>
              <span className="name">{rel(f.path)}</span>
              {f.tag && <span className="preview-tag">{f.tag}</span>}
            </button>
          ))}
          {list?.capped && <div className="menu-hint">Only the first {list.items.length} are listed; this worktree has more.</div>}
        </div>
      </div>
    </>
  );
}
