// The Agents screen's rail (VIEW-015, VIEW-021): sessions under each saved agent, + adds a
// not-started preset, and an empty state when no agent is switched on.
import { Plus } from "../chrome/icons";
import VendorMark from "../chrome/VendorMark";
import { markFor } from "../launch/PlusMenu";
import { OTHER, sessionLabel, type Group, type Session } from "./rail";

type Props<S extends Session> = { groups: Group<S>[]; selected: number | null; classic: boolean; onSelect: (key: number) => void; onAdd: (agentId: string) => void; onSettings: () => void };

export default function AgentsRail<S extends Session>({ groups, selected, classic, onSelect, onAdd, onSettings }: Props<S>) {
  const look = classic ? " classic" : "";
  return (
    <div className={`sidebar-wrap rail-wrap${look}`}>
      <nav className={`sidebar rail${look}`} aria-label="Sessions by agent">
        {groups.length === 0 ? (
          <div className="empty">
            <h2>No agents yet</h2>
            <p>Switch one on to start a session.</p>
            <button className="btn" onClick={onSettings}>
              Open Settings
            </button>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.id} className="rail-group" data-agent={g.id} aria-label={g.name}>
              <div className="proj">
                <span className="name">{g.name}</span>
                {g.id !== OTHER && (
                  <button className="ib" aria-label={`Add a ${g.name} session`} title={`Add a ${g.name} session`} onClick={() => onAdd(g.id)}>
                    <Plus size={14} />
                  </button>
                )}
              </div>
              {g.sessions.map((p) => (
                <div key={p.key} className={`sess${p.key === selected ? " sel" : ""}${p.seats ? " pending" : ""}`} role="button" tabIndex={0} data-session={p.key} onClick={() => onSelect(p.key)} onKeyDown={(e) => e.key === "Enter" && onSelect(p.key)}>
                  <VendorMark agent={markFor(p.agentId ?? g.id)} size={13} />
                  <span className="name">{p.seats ? "New session" : sessionLabel(p)}</span>
                </div>
              ))}
            </section>
          ))
        )}
      </nav>
    </div>
  );
}
