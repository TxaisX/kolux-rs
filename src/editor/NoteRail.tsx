// EDIT-020 (T-132-b): review notes in a margin rail beside the rich Markdown view, each tied to the
// text it quotes. The rail follows the document's scroll; a click on a card brings its text into view.
import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { Close } from "../chrome/icons";
import type { Note } from "./notes";
import { placeRail, quoteTop, railItems } from "./rail";

/** Card height in px; the card shows two lines of the note, so the rail can stack without measuring. */
export const CARD_HEIGHT = 58;

type Props = {
  host: RefObject<HTMLElement | null>;
  notes: Note[];
  /** The note's text, so a change in the document re-places the cards. */
  version: string;
  onRemove?: (n: Note) => void;
};

export default function NoteRail({ host, notes, version, onRemove }: Props) {
  const [tops, setTops] = useState<Record<string, number>>({});
  const [scroll, setScroll] = useState(0);
  const [frame, setFrame] = useState({ top: 0, height: 0 });
  const place = () => {
    const el = host.current;
    if (!el) return;
    setFrame({ top: el.offsetTop, height: el.clientHeight });
    setScroll(el.scrollTop);
    setTops(placeRail(railItems(notes, notes.map((n) => quoteTop(el, n.quote)), CARD_HEIGHT)));
  };
  useLayoutEffect(place, [notes, version]);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onScroll = () => setScroll(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", place);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", place);
    };
  }, [host, notes]);
  const items = railItems(notes, notes.map(() => null), CARD_HEIGHT);
  return (
    <div className="note-rail" role="complementary" aria-label="Review notes" style={{ top: frame.top, height: frame.height }}>
      {notes.map((n, i) => {
        const top = tops[items[i].id] ?? i * (CARD_HEIGHT + 6);
        return (
          <div
            key={`${n.time}:${i}`}
            className="rail-card"
            style={{ transform: `translateY(${top - scroll}px)`, height: CARD_HEIGHT }}
            onClick={() => host.current && host.current.scrollTo({ top: Math.max(0, top - 40), behavior: "smooth" })}
          >
            <span className="rail-where">Line {n.line}</span>
            <span className="rail-text">{n.note}</span>
            {onRemove && (
              <button
                className="ib rail-x"
                title="Remove this note"
                aria-label="Remove this note"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(n);
                }}
              >
                <Close size={10} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
