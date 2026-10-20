// EDIT-057 (T-237-b): the thin formatting toolbar above a note in rich view. A press never takes the
// focus from the text, so the caret and selection stay where they were. Link opens a small address box
// in the bar (the one place that must take the focus; Enter or Escape gives it back to the text);
// Image opens the system file picker for a picture and writes its markdown at the caret.
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { applyFormat, applyImage, applyLink, imageLink, linkAt, MORE_BLOCKS, RICH_BUTTONS, type RichAction } from "./richFormat";
import type { Rich } from "./markdown";

const PICTURES = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];

export default function RichToolbar({ get, notePath = "", onNote }: { get: () => Rich | null; notePath?: string; onNote?: (text: string) => void }) {
  const [link, setLink] = useState<string | null>(null); // the address box: null = closed
  const back = () => get()?.editor.focus();
  const pickImage = async () => {
    const r = get();
    if (!r) return;
    try {
      const file = await open({ multiple: false, directory: false, filters: [{ name: "Pictures", extensions: PICTURES }] });
      if (typeof file !== "string") return;
      if (!applyImage(r.editor, imageLink(notePath, file))) onNote?.("Put the caret in the note first, then choose a picture.");
      back();
    } catch (e) {
      onNote?.(`Could not insert the picture: ${String(e)}`);
    }
  };
  const run = (a: RichAction) => {
    const r = get();
    if (!r) return;
    if (a === "link") return setLink(link === null ? linkAt(r.editor) : null);
    if (a === "image") return void pickImage();
    applyFormat(r.editor, a);
  };
  const submit = () => {
    const r = get();
    if (!r || link === null) return;
    if (!applyLink(r.editor, link)) {
      onNote?.(link.trim() ? "That address is not allowed in a link." : "Put the caret in the note first.");
      return;
    }
    setLink(null);
    back();
  };
  return (
    <div className="rich-bar" role="toolbar" aria-label="Formatting" onMouseDown={(e) => e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement || e.preventDefault()}>
      {RICH_BUTTONS.map((b) => (
        <button key={b.id} type="button" className={`ib rich-${b.id}`} title={b.tip} aria-label={b.tip} aria-pressed={b.id === "link" ? link !== null : undefined} onClick={() => run(b.id)}>
          {b.label}
        </button>
      ))}
      {link !== null && (
        <input
          className="rich-link-box"
          aria-label="Link address"
          placeholder="Address, empty to remove the link"
          value={link}
          autoFocus
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.preventDefault(), submit());
            else if (e.key === "Escape") (setLink(null), back());
          }}
        />
      )}
      <select
        className="rich-more"
        aria-label="More blocks"
        title="More blocks"
        value=""
        onChange={(e) => {
          run(e.target.value as RichAction);
          get()?.editor.focus();
        }}
      >
        <option value="">More</option>
        {MORE_BLOCKS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.tip}
          </option>
        ))}
      </select>
    </div>
  );
}
