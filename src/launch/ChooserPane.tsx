// A pane where nothing runs yet (SESS-007): it asks what to run. One radio group per seat for the
// AI (installed agents, or a plain terminal) and, for an AI, a second radio group for the model;
// Start stays disabled until every seat has both picks. A count row (SESS-013) grows the seat
// list with empty seats or shrinks it from the bottom. Native radios and a number field carry the
// keyboard and screen-reader behaviour. The close button is absent when this is the grid's only
// pane.
import { Close } from "../chrome/icons";
import VendorMark from "../chrome/VendorMark";
import { markFor, type AgentInfo } from "./PlusMenu";
import { allReady, modelsFor, QUICK_COUNTS, resizeSeats, TERMINAL, type Seat } from "./seats";

type Props = {
  /** The session's number, shown in the header. */
  number: number;
  hidden?: boolean;
  focused?: boolean;
  /** Installed agents only. */
  agents: AgentInfo[];
  seats: Seat[];
  onSeats: (seats: Seat[]) => void;
  onStart: (seats: Seat[]) => void;
  busy?: boolean;
  /** False when this is the grid's only pane: then there is no close button. */
  closable: boolean;
  onClose: () => void;
  onFocus?: () => void;
};

export default function ChooserPane({ number, hidden = false, focused = false, agents, seats, onSeats, onStart, busy = false, closable, onClose, onFocus }: Props) {
  const setSeat = (i: number, patch: Partial<Seat>) => onSeats(seats.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const ready = allReady(seats) && !busy;
  // The free field applies on Enter or blur, not per keystroke: typing "15" must not pass
  // through a one-seat moment that drops the picks of seats 2 and up.
  const applyCount = (e: { currentTarget: HTMLInputElement }) => {
    const n = e.currentTarget.valueAsNumber;
    if (Number.isFinite(n) && n >= 1 && n !== seats.length) onSeats(resizeSeats(seats, n));
    else e.currentTarget.value = String(seats.length);
  };
  return (
    <section className={`pane chooser${focused ? " focused" : ""}`} hidden={hidden} aria-label={`Session ${number} chooser`} onMouseDown={onFocus}>
      <header className="pane-head">
        <span className="title">Session {number}</span>
        <span className="word">Choose what to run</span>
        <span className="right">
          {closable && (
            <button className="ib" onClick={onClose} title="Close this chooser">
              <Close size={12} />
            </button>
          )}
        </span>
      </header>
      <div className="chooser-body">
        <div className="count-row" role="group" aria-label="How many sessions">
          <span className="label">Sessions</span>
          {QUICK_COUNTS.map((n) => (
            <button key={n} className="btn" aria-pressed={seats.length === n} onClick={() => onSeats(resizeSeats(seats, n))}>
              {n}
            </button>
          ))}
          <input
            key={seats.length}
            className="count-field"
            type="number"
            min={1}
            aria-label="Any number of sessions"
            defaultValue={seats.length}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={applyCount}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyCount(e);
            }}
            onChange={(e) => {
              // The spinner and arrow keys step the value: that is a whole number, apply at once.
              if (!(e.nativeEvent as InputEvent).inputType) applyCount(e);
            }}
          />
        </div>
        <div className="seats">
          {seats.map((seat, i) => (
            <div key={i} className="seat">
              <div className="seat-title">Seat {i + 1}</div>
              <div className="choices" role="radiogroup" aria-label={`Seat ${i + 1}: which AI`}>
                {agents.map((a) => (
                  <label key={a.id} className="choice">
                    <input type="radio" name={`seat-${number}-${i}-ai`} checked={seat.agent === a.id} onChange={() => setSeat(i, { agent: a.id, model: null })} />
                    <VendorMark agent={markFor(a.id)} size={12} />
                    {a.name}
                  </label>
                ))}
                <label className="choice">
                  <input type="radio" name={`seat-${number}-${i}-ai`} checked={seat.agent === TERMINAL} onChange={() => setSeat(i, { agent: TERMINAL, model: null })} />
                  <VendorMark agent="shell" size={12} />
                  Terminal
                </label>
              </div>
              {seat.agent !== null && seat.agent !== TERMINAL && (
                <div className="choices" role="radiogroup" aria-label={`Seat ${i + 1}: which model`}>
                  <span className="label">{seat.model === null ? "Pick a model" : "Model"}</span>
                  {modelsFor(seat.agent).map((m) => (
                    <label key={m.id} className="choice">
                      <input type="radio" name={`seat-${number}-${i}-model`} checked={seat.model === m.id} onChange={() => setSeat(i, { model: m.id })} />
                      {m.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="btn-row">
          <button className="btn primary" disabled={!ready} onClick={() => onStart(seats)} title={ready ? "Start every seat" : "Pick an AI and a model (or Terminal) for every seat first"}>
            {busy ? "Starting…" : `Start${seats.length > 1 ? ` ${seats.length}` : ""}`}
          </button>
        </div>
      </div>
    </section>
  );
}
