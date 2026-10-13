// TERM-027, TERM-048: the inline field that names a pane or a tab. Enter (or Tab) saves and Escape
// cancels; an Enter that only confirms an IME candidate keeps it open. Clicking away saves. Keys
// and pastes stay in the field, so nothing reaches the terminal behind it.
import { useEffect, useRef, useState } from "react";
import { nameKey, newName } from "./tabs";

type Props = { value: string; label: string; onSave: (name: string | undefined) => void; onCancel: () => void };

export default function NameField({ value, label, onSave, onCancel }: Props) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  // Focus once the menu or the double-click that opened it has settled, so the field stays open.
  useEffect(() => {
    const t = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => cancelAnimationFrame(t);
  }, []);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) onSave(newName(text));
    else onCancel();
  };
  return (
    <input
      ref={ref}
      className="name-field"
      aria-label={label}
      value={text}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        const k = nameKey({ key: e.key, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode });
        if (!k) return;
        e.preventDefault();
        finish(k === "save");
      }}
      onBlur={() => finish(true)}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}
