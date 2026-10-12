// Settings > Shortcuts: where the shortcuts file lives and what it got wrong, then every command
// grouped by area with its keys, badges, a clash hint, the filters and the search (SET-008, SET-010),
// and on each row the recorder: click a chord to replace it, Add for another, x to remove one,
// Disable and Reset (SET-009). Every change is written to the file at once.
import { useEffect, useMemo, useState } from "react";
import { useKeymap } from "../keys/KeymapContext";
import { editChords, recordKey, recording, removeChord } from "../keys/record";
import { Segmented } from "./GeneralPage";
import { AREAS, FILTERS, MAX_QUERY, filterRows, shortcutRows, type Filter, type Row } from "./shortcutRows";

type Rec = { id: string; index: number };

export default function ShortcutsPage() {
  const keymap = useKeymap();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [rec, setRec] = useState<Rec | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const rows = useMemo(() => shortcutRows(keymap), [keymap]);
  const shown = filterRows(rows, filter, query);

  // While recording, every key press belongs to the recorder: the window's shortcuts stand
  // aside (`recording.on`) and Esc ends recording instead of closing Settings.
  useEffect(() => {
    if (!rec) return;
    recording.on = true;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const got = recordKey(e, keymap.platform, rec.id);
      if (got === null) return;
      if ("refused" in got) return setNote(got.refused);
      setRec(null);
      setNote(null);
      const now = rows.find((r) => r.id === rec.id)?.chords ?? [];
      if ("chord" in got) void keymap.save(rec.id, editChords(now, rec.index, got.chord));
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      recording.on = false;
      window.removeEventListener("keydown", onKey, true);
    };
  }, [rec, keymap, rows]);

  const record = (id: string, index: number) => {
    setNote(null);
    setRec(rec?.id === id && rec.index === index ? null : { id, index });
  };
  const remove = (r: Row, i: number) => {
    const out = removeChord(r.chords, i, rec?.id === r.id ? rec : null);
    if (rec?.id === r.id) setRec(out.recording && { id: r.id, index: out.recording.index });
    void keymap.save(r.id, out.chords);
  };
  const end = (then: () => void) => () => {
    setRec(null);
    then();
  };

  return (
    <>
      <section className="conn-card" data-section="shortcuts-file">
        <h2 className="conn-name">Shortcuts file</h2>
        <p className="conn-detail">{keymap.path ?? "Reading where the file is..."}</p>
        {keymap.errors.map((e, i) => (
          <p key={i} className="conn-detail warn">
            {e}
          </p>
        ))}
        <div className="btn-row">
          <button className="btn" onClick={keymap.reload}>
            Read the file again
          </button>
        </div>
      </section>
      <section className="conn-card" data-section="key-bindings">
        <h2 className="conn-name">Commands and keys</h2>
        <div className="keys-bar">
          <Segmented label="Show" options={FILTERS.map(([id, label]) => ({ id, label }))} value={filter} onPick={setFilter} />
          <input className="field" type="search" aria-label="Search shortcuts" placeholder="Search commands or keys" maxLength={MAX_QUERY} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {shown.length === 0 && <p className="conn-detail">No command matches.</p>}
        {Object.values(AREAS).map((area) => {
          const group = shown.filter((r) => r.area === area);
          if (group.length === 0) return null;
          return (
            <div key={area} className="keys-group">
              <h3 className="keys-area">{area}</h3>
              <table className="keys-table">
                <tbody>
                  {group.map((r) => {
                    const at = rec?.id === r.id ? rec.index : -1;
                    return (
                      <tr key={r.id} data-id={r.id} className={at >= 0 ? "recording" : undefined}>
                        <td>
                          {r.title}
                          {r.hint && <p className="keys-hint">{r.hint}</p>}
                          {at >= 0 && <p className="keys-hint">{note ?? "Press the new keys. Esc keeps what was there."}</p>}
                        </td>
                        <td>
                          {r.labels.map((l, i) => (
                            <span key={i} className="keys-slot">
                              <button className={`keys-chord${at === i ? " on" : ""}`} title="Click, then press the new keys" onClick={() => record(r.id, i)}>
                                {at === i ? "Press keys..." : l}
                              </button>
                              <button className="keys-x" aria-label={`Remove ${l}`} title="Remove this shortcut" onClick={() => remove(r, i)}>
                                ×
                              </button>
                            </span>
                          ))}
                          {at === r.labels.length && <span className="keys-chord on">Press keys...</span>}
                          {r.labels.length === 0 && at < 0 && <span className="kbd-none">None</span>}
                        </td>
                        <td className="keys-badges">
                          {r.badges.map((b) => (
                            <span key={b} className={`chip keys-badge ${b.toLowerCase()}`}>
                              {b}
                            </span>
                          ))}
                        </td>
                        <td className="keys-acts">
                          <button className="keys-act" onClick={() => record(r.id, r.chords.length)}>
                            Add
                          </button>
                          {r.chords.length > 0 && (
                            <button className="keys-act" onClick={end(() => void keymap.save(r.id, null))}>
                              Disable
                            </button>
                          )}
                          {r.custom && (
                            <button className="keys-act" onClick={end(() => void keymap.save(r.id, r.defaults, true))}>
                              Reset
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </section>
    </>
  );
}
