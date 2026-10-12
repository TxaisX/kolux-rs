// Settings > Shortcuts: where the shortcuts file lives and what it got wrong, then every command
// grouped by area with its keys, badges, a clash hint, the filters and the search (SET-008, SET-010).
// Recording and editing a binding come with T-096-b; the terminal-focus note with T-246.
import { useMemo, useState } from "react";
import { useKeymap } from "../keys/KeymapContext";
import { Segmented } from "./GeneralPage";
import { AREAS, FILTERS, MAX_QUERY, filterRows, shortcutRows, type Filter } from "./shortcutRows";

export default function ShortcutsPage() {
  const keymap = useKeymap();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const rows = useMemo(() => shortcutRows(keymap), [keymap]);
  const shown = filterRows(rows, filter, query);
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
                  {group.map((r) => (
                    <tr key={r.id} data-id={r.id}>
                      <td>
                        {r.title}
                        {r.hint && <p className="keys-hint">{r.hint}</p>}
                      </td>
                      <td>
                        {r.labels.length ? r.labels.map((l) => <span key={l} className="keys-chord">{l}</span>) : <span className="kbd-none">None</span>}
                      </td>
                      <td className="keys-badges">
                        {r.badges.map((b) => (
                          <span key={b} className={`chip keys-badge ${b.toLowerCase()}`}>
                            {b}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </section>
    </>
  );
}
