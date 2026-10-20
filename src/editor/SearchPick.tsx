// EDIT-048 (T-317): a text box for a repository or base branch that narrows its suggestions as you type
// (pickList: every typed word, prefix matches first, at most 50 shown and the rest counted). The box stays
// free text, so a name that is not in the list can still be typed. Used by the automation dialog; the
// pull request composer's base field can take it once it has a branch list.
import { useState } from "react";
import { pickList } from "./pickerSearch";

type Props = { items: readonly string[]; value: string; onChange: (v: string) => void; label: string; placeholder?: string };

export default function SearchPick({ items, value, onChange, label, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const { shown, more } = pickList(items, value);
  const exact = items.includes(value);
  return (
    <div className="search-pick" onBlur={(e) => e.currentTarget.contains(e.relatedTarget as Node | null) || setOpen(false)}>
      <input
        className="field"
        aria-label={label}
        aria-expanded={open}
        role="combobox"
        aria-autocomplete="list"
        value={value}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => (onChange(e.target.value), setOpen(true))}
        onKeyDown={(e) => e.key === "Escape" && open && (e.stopPropagation(), setOpen(false))}
      />
      {open && !exact && (shown.length > 0 || more > 0) && (
        <div className="search-pick-list" role="listbox" aria-label={`${label} suggestions`}>
          {shown.map((s) => (
            <button key={s} type="button" role="option" aria-selected={false} className="menu-item" onClick={() => (onChange(s), setOpen(false))}>
              {s}
            </button>
          ))}
          {more > 0 && <div className="search-pick-more">{more} more, type to narrow</div>}
        </div>
      )}
    </div>
  );
}
