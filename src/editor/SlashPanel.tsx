// EDIT-010 (T-234-b): draws the slash menu and the table menu over the rich view. The state lives in
// slashMenu.ts and richTable.ts; these two only place a small panel next to the caret.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LexicalEditor } from "lexical";
import type { SlashView } from "./slashMenu";
import { runTableAction, TABLE_ACTIONS, watchTable, type TableActionId } from "./richTable";

/** The caret's spot on screen, or null when there is none. */
function caretSpot(): { x: number; y: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  return r.width === 0 && r.height === 0 && r.top === 0 ? null : { x: r.left, y: r.bottom };
}

export function SlashMenu({ view, onPick }: { view: SlashView | null; onPick: (id: string) => void }) {
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (view) setSpot(caretSpot());
  }, [view?.query]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [view?.index, view?.query]);
  if (!view || !spot) return null;
  return (
    <div ref={list} className="slash-menu" role="listbox" aria-label="Insert" style={{ left: Math.min(spot.x, window.innerWidth - 260), top: Math.min(spot.y + 4, window.innerHeight - 260) }} onMouseDown={(e) => e.preventDefault()}>
      {view.items.map((it, i) => (
        <div key={it.id} role="option" aria-selected={i === view.index} className="slash-item" onClick={() => onPick(it.id)}>
          <span className="slash-label">{it.label}</span>
          <span className="slash-hint">{it.hint}</span>
        </div>
      ))}
    </div>
  );
}

/** A thin bar of row and column buttons, shown while the caret is inside a table. */
export function TableMenu({ editor }: { editor: LexicalEditor | null }) {
  const [on, setOn] = useState(false);
  useEffect(() => (editor ? watchTable(editor, setOn) : undefined), [editor]);
  if (!editor || !on) return null;
  return (
    <div className="table-menu" role="toolbar" aria-label="Table" onMouseDown={(e) => e.preventDefault()}>
      {TABLE_ACTIONS.map((a) => (
        <button key={a.id} type="button" className="btn" onClick={() => runTableAction(editor, a.id as TableActionId)}>
          {a.label}
        </button>
      ))}
    </div>
  );
}
