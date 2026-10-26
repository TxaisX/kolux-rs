// T-241 (BROW-038), T-240 (BROW-035): "Send to agent" with the list of agent sessions in this worktree,
// shared by the drawing canvas and the element sheet. The same targets the page notes go to.
import { useState } from "react";
import type { SendTarget } from "../editor/notes";

type Props = { targets?: () => SendTarget[]; busy: boolean; onPick: (key: number) => void };

export function SendButton({ targets, busy, onPick }: Props) {
  const [list, setList] = useState<SendTarget[] | null>(null);
  const [none, setNone] = useState(false);
  const open = () => {
    const t = targets?.() ?? [];
    setNone(t.length === 0);
    setList(t.length ? t : null);
  };
  return (
    <span className="send-wrap">
      <button type="button" className="btn" data-go="send" disabled={busy} onClick={() => (list || none ? (setList(null), setNone(false)) : open())} aria-haspopup="menu" aria-expanded={!!list}>
        {busy ? "Sending…" : "Send to agent"}
      </button>
      {none && <small className="send-none">No agent sessions in this worktree</small>}
      {list && (
        <ul className="send-menu" role="menu" aria-label="Send to">
          {list.map((t) => (
            <li key={t.key}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setList(null);
                  onPick(t.key);
                }}
              >
                {t.label} <small>{t.since}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
