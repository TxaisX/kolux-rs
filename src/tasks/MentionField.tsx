// GIT-053: a text box that offers people when @ is typed: a filtered list with avatars (initials
// when GitHub gives none); arrow keys move, Enter or Tab picks, Escape closes. Used by the
// description editor now and by the comment box (T-231-c).
import { useRef, useState } from "react";
import { initials, insertMention, mentionAt, mentionMatches } from "./people";
import type { Person } from "./repoFacts";

export function Avatar({ person }: { person: Person }) {
  return person.avatar ? <img className="task-avatar" src={person.avatar} alt="" referrerPolicy="no-referrer" /> : <span className="task-avatar initials">{initials(person.login)}</span>;
}

export default function MentionField({ value, onChange, people, label, className }: { value: string; onChange: (v: string) => void; people: Person[]; label: string; className?: string }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [pick, setPick] = useState(0);
  const [closed, setClosed] = useState<number | null>(null);
  const m = caret === null ? null : mentionAt(value, caret);
  const offer = m && closed !== m.start ? mentionMatches(people, m.query) : [];
  const choose = (p: Person) => {
    if (!m || caret === null) return;
    const next = insertMention(value, m.start, caret, p.login);
    onChange(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => field.current?.setSelectionRange(next.caret, next.caret));
  };
  const track = (el: HTMLTextAreaElement) => {
    setCaret(el.selectionStart === el.selectionEnd ? el.selectionStart : null);
  };
  return (
    <div className="mention-field">
      <textarea
        ref={field}
        className={`field ${className ?? ""}`}
        aria-label={label}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          track(e.target);
          setPick(0);
          setClosed(null);
        }}
        onSelect={(e) => track(e.currentTarget)}
        onBlur={() => setCaret(null)}
        onKeyDown={(e) => {
          if (offer.length === 0) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setPick((i) => (i + (e.key === "ArrowDown" ? 1 : offer.length - 1)) % offer.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            choose(offer[Math.min(pick, offer.length - 1)]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (m) setClosed(m.start);
          }
        }}
      />
      {offer.length > 0 && (
        <ul className="mention-list" role="listbox" aria-label="People" data-mentions>
          {offer.map((p, i) => (
            <li
              key={p.login}
              role="option"
              aria-selected={i === pick}
              data-person={p.login}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(p);
              }}
            >
              <Avatar person={p} />
              <span>{p.login}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
