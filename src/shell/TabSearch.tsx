// TERM-053: the tab search box. Opens on the shortcut or the palette command, lists open tabs whose own name matches what is typed, Enter or a click jumps to one.
import { useEffect, useMemo, useRef, useState } from "react";
import { onTabSearch, tabSearcher, type TabEntry } from "./findTab";

type Props = { tabs: () => TabEntry[] };

export default function TabSearch({ tabs }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<TabEntry[]>([]);
  const [at, setAt] = useState(0);
  useEffect(
    () =>
      onTabSearch(() => {
        setQuery("");
        setRows([]);
        setAt(0);
        setOpen(true);
      }),
    [],
  );
  const list = useRef(tabs);
  list.current = tabs;
  const search = useMemo(() => tabSearcher(() => list.current(), setRows), []);
  useEffect(() => {
    if (open) void search(query);
  }, [open, query, search]);
  if (!open) return null;
  const go = (row: TabEntry | undefined) => {
    if (!row) return;
    setOpen(false);
    row.run();
  };
  return (
    <>
      <div className="menu-backdrop" onMouseDown={() => setOpen(false)} />
      <div className="menu note-picker palette" role="dialog" aria-label="Search open tabs">
        <input
          autoFocus
          className="picker-input"
          placeholder="Search open tabs by name"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAt(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            else if (e.key === "Enter") go(rows[at]);
            else if (e.key === "ArrowDown") setAt(Math.min(at + 1, rows.length - 1));
            else if (e.key === "ArrowUp") setAt(Math.max(at - 1, 0));
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
        />
        <div className="picker-list" role="listbox">
          {rows.map((r, i) => (
            <button key={`${r.label}|${r.hint ?? ""}|${i}`} role="option" aria-selected={i === at} className={`menu-item${i === at ? " at" : ""}`} onClick={() => go(r)}>
              <span className="name">{r.label}</span>
              {r.hint && <span className="hint">{r.hint}</span>}
            </button>
          ))}
          {query.trim() !== "" && rows.length === 0 && <div className="menu-hint">No open tab has that in its name</div>}
        </div>
      </div>
    </>
  );
}
