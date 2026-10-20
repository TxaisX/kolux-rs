// PROJ-061 (T-303): a text field that offers emoji while a `:word` is typed. Enter (or Tab) takes the
// highlighted one, Escape closes the list and leaves the typed text alone, and any text after the
// caret is kept. While an input method (IME) is composing, no key is taken. Every other key goes to
// the field's own onKeyDown as before, so the field behaves exactly as a plain input otherwise.
import { useRef, useState, type InputHTMLAttributes, type KeyboardEvent } from "react";
import { shortcodeAt, shortcodeKey, suggest, withEmoji, type Shortcode } from "./shortcodes";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & { value: string; onValue: (value: string) => void };

export default function ShortcodeInput({ value, onValue, onKeyDown, onBlur, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  // The start of the `:word` whose list Escape closed; typing on in the same word keeps it closed.
  const [closed, setClosed] = useState<number | null>(null);
  const [pick, setPick] = useState(0);
  const at = caret === null ? null : shortcodeAt(value, caret);
  const list: Shortcode[] = at && at.start !== closed ? suggest(at.query) : [];
  const open = list.length > 0;
  const shown = Math.min(pick, Math.max(0, list.length - 1));

  const readCaret = () => setCaret(ref.current?.selectionStart ?? null);
  const take = (s: Shortcode) => {
    if (!at || caret === null) return;
    const next = withEmoji(value, at.start, caret, s.emoji);
    onValue(next.text);
    setCaret(next.caret);
    setPick(0);
    requestAnimationFrame(() => ref.current?.setSelectionRange(next.caret, next.caret));
  };
  const keyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const composing = e.nativeEvent.isComposing || e.keyCode === 229;
    const act = shortcodeKey(e.key, composing, open);
    if (act !== null) {
      e.preventDefault();
      e.stopPropagation();
      if (act === "take") take(list[shown]);
      else if (act === "close") setClosed(at?.start ?? null);
      else setPick((n) => (act === "down" ? (n + 1) % list.length : (n - 1 + list.length) % list.length));
      return;
    }
    onKeyDown?.(e);
  };
  const rect = open ? ref.current?.getBoundingClientRect() : undefined;

  return (
    <>
      <input
        {...rest}
        ref={ref}
        value={value}
        onChange={(e) => {
          onValue(e.target.value);
          setCaret(e.target.selectionStart);
          setPick(0);
        }}
        onSelect={readCaret}
        onKeyDown={keyDown}
        onBlur={(e) => {
          setCaret(null);
          onBlur?.(e);
        }}
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {open && rect && (
        <div className="menu" role="listbox" aria-label="Emoji" data-shortcodes style={{ left: rect.left, top: rect.bottom + 4, minWidth: 200 }}>
          {list.map((s, i) => (
            <button
              key={s.code}
              type="button"
              role="option"
              aria-selected={i === shown}
              className="menu-item"
              style={i === shown ? { background: "var(--row-selected)" } : undefined}
              // mousedown, not click: the field keeps its focus (a blur would end a rename)
              onMouseDown={(e) => {
                e.preventDefault();
                take(s);
              }}
            >
              <span aria-hidden>{s.emoji}</span> :{s.code}:
            </button>
          ))}
        </div>
      )}
    </>
  );
}
