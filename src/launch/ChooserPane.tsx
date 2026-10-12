// A pane where nothing runs yet (SESS-007): it asks what to run. One radio group per seat for the
// AI (installed agents, or a plain terminal) and, for an AI, a second radio group for the model;
// Start stays disabled until every seat has both picks. A count row (SESS-013) grows the seat
// list with empty seats or shrinks it from the bottom. Native radios and a number field carry the
// keyboard and screen-reader behaviour. The close button is absent when this is the grid's only
// pane. A shape row (SESS-012) gives the seats roles, each shown on its seat, and one task box
// holds the task every seat shares, so the whole lineup is in view before Start. Start sits in a
// footer below the scrolling choices, so in a small pane it stays in view after a pick.
import { Close } from "../chrome/icons";
import { launchWarnings, useLaunchUsage } from "../usage/launchWarn";
import VendorMark from "../chrome/VendorMark";
import { markFor, type AgentInfo } from "./PlusMenu";
import { allReady, modelsFor, NOT_GIT, pickShape, QUICK_COUNTS, resizeLineup, sameForAll, seatReady, SHAPES, sharedWarning, TERMINAL, type Copies, type Seat, type Shape } from "./seats";

type Props = {
  /** The session's number, shown in the header. */
  number: number;
  hidden?: boolean;
  focused?: boolean;
  /** Installed agents only. */
  agents: AgentInfo[];
  seats: Seat[];
  onSeats: (seats: Seat[]) => void;
  /** SESS-012: the launch shape; a shape pick or a count change sets the shape and the seats together. */
  shape: Shape;
  onLineup: (shape: Shape, seats: Seat[]) => void;
  /** SESS-012: the task every seat shares; blank means none. */
  task: string;
  onTask: (task: string) => void;
  onStart: (seats: Seat[]) => void;
  /** SESS-014: where the AIs work; `inGit` false disables the separate copies. */
  copies: Copies;
  inGit: boolean;
  onCopies: (copies: Copies) => void;
  busy?: boolean;
  /** False when this is the grid's only pane: then there is no close button. */
  closable: boolean;
  onClose: () => void;
  onFocus?: () => void;
};

export default function ChooserPane({ number, hidden = false, focused = false, agents, seats, onSeats, shape, onLineup, task, onTask, onStart, copies, inGit, onCopies, busy = false, closable, onClose, onFocus }: Props) {
  const setSeat = (i: number, patch: Partial<Seat>) => onSeats(seats.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const ready = allReady(seats) && !busy;
  const anyReady = seats.some(seatReady);
  // SESS-022: a line per provider near its limit, above Start; it never disables Start.
  const warnings = launchWarnings(seats.map((s) => s.agent), useLaunchUsage());
  // The free field applies on Enter or blur, not per keystroke: typing "15" must not pass
  // through a one-seat moment that drops the picks of seats 2 and up.
  const recount = (n: number) => {
    const next = resizeLineup(shape, seats, n);
    onLineup(next.shape, next.seats);
  };
  const applyCount = (e: { currentTarget: HTMLInputElement }) => {
    const n = e.currentTarget.valueAsNumber;
    if (Number.isFinite(n) && n >= 1 && n !== seats.length) recount(n);
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
        <p className="caption">Every seat starts blank. Kolux never picks an AI or a model for you.</p>
        <div className="count-row" role="group" aria-label="Launch shape">
          <span className="label">Shape</span>
          {SHAPES.map((s) => (
            <button key={s.id} className="btn" aria-pressed={shape === s.id} title={s.roles.length ? s.roles.join(", ") : "No roles"} onClick={() => onLineup(s.id, pickShape(s.id, seats))}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="count-row" role="group" aria-label="How many sessions">
          <span className="label">Sessions</span>
          {QUICK_COUNTS.map((n) => (
            <button key={n} className="btn" aria-pressed={seats.length === n} onClick={() => recount(n)}>
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
          <button className="btn" disabled={!anyReady || seats.length < 2} onClick={() => onSeats(sameForAll(seats))} title="Copy the first finished seat's AI and model into every seat">
            Same for all
          </button>
        </div>
        <div className="count-row" role="radiogroup" aria-label="Where the AIs work">
          <span className="label">Folders</span>
          <label className="choice" title={inGit ? "Each AI seat gets a fresh worktree of its own" : NOT_GIT}>
            <input type="radio" name={`copies-${number}`} checked={copies === "separate"} disabled={!inGit} onChange={() => onCopies("separate")} />
            Separate copy for each AI
          </label>
          <label className="choice" title="Every seat opens in this folder">
            <input type="radio" name={`copies-${number}`} checked={copies === "shared"} onChange={() => onCopies("shared")} />
            Same folder for all
          </label>
          {!inGit && <span className="caption">{NOT_GIT}</span>}
        </div>
        {sharedWarning(copies, seats.length, inGit) && (
          <div className="note warn" role="status">
            Several AIs would be editing the same files at once.{" "}
            <button className="btn" onClick={() => onCopies("separate")}>
              Give each its own copy
            </button>
          </div>
        )}
        <textarea
          className="seat-prompt"
          rows={2}
          placeholder="Task for every seat (optional)"
          aria-label="Task for every seat"
          value={task}
          onChange={(e) => onTask(e.currentTarget.value)}
        />
        <div className="seats">
          {seats.map((seat, i) => (
            <div key={i} className="seat">
              <div className="seat-head">
                <span className="seat-title">Seat {i + 1}</span>
                {seat.role && (
                  <span className="chip seat-role" title="This seat's role">
                    {seat.role}
                  </span>
                )}
                <input
                  className="seat-job"
                  type="text"
                  placeholder="Job title (optional)"
                  aria-label={`Seat ${i + 1}: job title`}
                  value={seat.title ?? ""}
                  onChange={(e) => setSeat(i, { title: e.currentTarget.value })}
                />
              </div>
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
              {seat.agent !== null && modelsFor(seat.agent).length > 0 && (
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
              {seat.agent !== null && seat.agent !== TERMINAL && (
                <textarea
                  className="seat-prompt"
                  rows={2}
                  placeholder="Opening prompt (optional)"
                  aria-label={`Seat ${i + 1}: opening prompt`}
                  value={seat.prompt ?? ""}
                  onChange={(e) => setSeat(i, { prompt: e.currentTarget.value })}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      <footer className="chooser-foot">
        {warnings.map((w) => (
          <div key={w} className="note warn" role="status">
            {w}
          </div>
        ))}
        <div className="btn-row">
          <button className="btn primary" disabled={!ready} onClick={() => onStart(seats)} title={ready ? "Start every seat" : "Pick an AI and a model (or Terminal) for every seat first"}>
            {busy ? "Starting…" : `Start${seats.length > 1 ? ` ${seats.length}` : ""}`}
          </button>
        </div>
      </footer>
    </section>
  );
}
