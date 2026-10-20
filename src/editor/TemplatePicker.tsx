// EDIT-055 (T-318): the picker Mod+Shift+M opens when the repository keeps note templates. It lists
// Blank and each template by name; choosing one makes the note, Escape or a click outside makes
// nothing. With no templates it never shows: the blank note is made and opened at once.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { beginNote, rows, step, type Io, type Template } from "./templates";

type Props = { root: string; onOpen: (path: string) => void; onError: (message: string) => void; onClose: () => void };

const io: Io = {
  list: (root) => invoke<Template[]>("md_templates", { root }),
  make: (root, template) => invoke<string>("md_new", template ? { root, template } : { root }),
};

export default function TemplatePicker({ root, onOpen, onError, onClose }: Props) {
  const [ask, setAsk] = useState<Template[] | null>(null);
  const [at, setAt] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    // Once only: a note is a file, and a second run would make a second one.
    if (started.current) return;
    started.current = true;
    beginNote(root, io).then(
      (r) => {
        if ("opened" in r) {
          onOpen(r.opened);
          onClose();
        } else setAsk(r.ask);
      },
      (err) => {
        onError(String(err));
        onClose();
      },
    );
  }, []);

  if (!ask) return null;
  const list = rows(ask);
  const choose = (path: string | null) => {
    onClose();
    io.make(root, path).then(onOpen, (err) => onError(String(err)));
  };
  return (
    <>
      <div className="menu-backdrop" onMouseDown={onClose} />
      <div className="menu note-picker" role="dialog" aria-label="Start a note from a template">
        <div
          className="picker-list"
          role="listbox"
          tabIndex={0}
          ref={(el) => el?.focus()}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "Enter") choose(list[at]?.path ?? null);
            else if (e.key === "ArrowDown" || e.key === "ArrowUp") setAt((i) => step(i, e.key, list.length));
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {list.map((r, i) => (
            <button key={r.path ?? "blank"} role="option" aria-selected={i === at} className={`menu-item${i === at ? " at" : ""}`} onMouseEnter={() => setAt(i)} onClick={() => choose(r.path)}>
              <span className="name">{r.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
