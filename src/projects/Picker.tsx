// SESS-035 / SESS-037: a searchable list behind a button, used by the composer for the project and
// the parent worktree. Enter takes the highlighted item (or `onEmptyEnter` with nothing typed),
// arrows move, and Escape closes only the list.
import { Fragment, useState } from "react";

export type PickItem = { key: string; label: string; hint?: string; hits?: number[]; group?: string; title?: string };

const marked = (text: string, hits: number[] = []) => [...text].map((ch, i) => (hits.includes(i) ? <mark key={i}>{ch}</mark> : ch));

export default function Picker(props: { name: string; value: string; items: (query: string) => PickItem[]; onPick: (key: string) => void; onEmptyEnter?: () => void; startOpen?: boolean }) {
  const [open, setOpen] = useState(!!props.startOpen);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const list = open ? props.items(query) : [];
  const close = () => {
    setOpen(false);
    setQuery("");
    setAt(0);
  };
  const take = (key: string) => {
    close();
    props.onPick(key);
  };
  return (
    <div className="picker" data-picker={props.name}>
      <button className="field pick" aria-expanded={open} title={props.value} onClick={() => (open ? close() : setOpen(true))}>
        <span className="pick-name">{props.name}:</span> <span className="pick-value">{props.value}</span>
      </button>
      {open && (
        <>
          <input
            autoFocus
            aria-label={`search ${props.name.toLowerCase()}`}
            className="field"
            placeholder="type to search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setAt(0);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setAt(Math.min(at + 1, list.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setAt(Math.max(at - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (!query.trim() && props.onEmptyEnter) {
                  close();
                  props.onEmptyEnter();
                } else if (list[at]) take(list[at].key);
              } else if (e.key === "Escape") {
                e.stopPropagation();
                close();
              }
            }}
          />
          <div role="listbox" aria-label={props.name} className="pick-list">
            {list.length === 0 && <div className="pick-group">no match</div>}
            {list.map((it, n) => (
              <Fragment key={it.key}>
                {it.group && it.group !== list[n - 1]?.group && <div className="pick-group">{it.group}</div>}
                <div role="option" aria-selected={n === at} className="pick-item" title={it.title ?? it.label} onMouseEnter={() => setAt(n)} onMouseDown={(e) => (e.preventDefault(), take(it.key))}>
                  <span className="name">{marked(it.label, it.hits)}</span>
                  {it.hint && <span className="hint">{it.hint}</span>}
                </div>
              </Fragment>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
