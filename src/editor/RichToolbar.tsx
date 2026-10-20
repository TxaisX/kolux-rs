// EDIT-057 (T-237-b): the thin formatting toolbar above a note in rich view. A press never takes the
// focus from the text, so the caret and selection stay where they were.
import { applyFormat, MORE_BLOCKS, RICH_BUTTONS, type RichAction } from "./richFormat";
import type { Rich } from "./markdown";

export default function RichToolbar({ get }: { get: () => Rich | null }) {
  const run = (a: RichAction) => {
    const r = get();
    if (r) applyFormat(r.editor, a);
  };
  return (
    <div className="rich-bar" role="toolbar" aria-label="Formatting" onMouseDown={(e) => e.target instanceof HTMLSelectElement || e.preventDefault()}>
      {RICH_BUTTONS.map((b) => (
        <button key={b.id} type="button" className={`ib rich-${b.id}`} title={b.tip} aria-label={b.tip} onClick={() => run(b.id)}>
          {b.label}
        </button>
      ))}
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
