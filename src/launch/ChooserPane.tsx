// A pane where nothing runs yet (SESS-007): it asks what to run. One radio group per seat for the
// AI (installed agents, or a plain terminal) and, for an AI, a second radio group for the model;
// Start stays disabled until every seat has both picks. A count row (SESS-013) grows the seat
// list with empty seats or shrinks it from the bottom. Native radios and a number field carry the
// keyboard and screen-reader behaviour. The close button is absent when this is the grid's only
// pane. A shape row (SESS-012) gives the seats roles, each shown on its seat, and one task box
// holds the task every seat shares, so the whole lineup is in view before Start. Start sits in a
// footer below the scrolling choices, so in a small pane it stays in view after a pick. Saved shapes
// (SESS-020) sit after the built-in ones; each has a menu to rename or delete it, and a delete can
// be undone from the note it leaves. A model with
// effort levels or fast mode shows those options on its seat only (SESS-016); "Use last lineup"
// (SESS-021) appears when this project has one whose agents are still here.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Close, Dots } from "../chrome/icons";
import { openSettings } from "../settings/pages";
import { launchWarnings, useLaunchUsage } from "../usage/launchWarn";
import VendorMark from "../chrome/VendorMark";
import { markFor, type AgentInfo } from "./PlusMenu";
import { KitIcon, openKits } from "../kits/Kits";
import { KITS, VENDOR_NAME, assignRoles, type Vendor } from "../kits/catalog";
import { canLaunch, FEATURED, type AgentPass } from "./agents";
import { allReady, modelsFor, NOT_GIT, pickShape, QUICK_COUNTS, renameShape, resizeLineup, sameForAll, saveShape, seatGap, seatReady, SHAPES, sharedWarning, TERMINAL, type Copies, type SavedShape, type Seat, type Shape, choiceOf, DEFAULT_MODEL, lineupAgents, type Lineup } from "./seats";

/** Agents whose own page `open_install_page` knows (agents.rs `install_page`). */
const DOC_PAGES = ["claude", "codex", "grok"];

/** SESS-017: the featured three first (a missing one only once detection is done), the other
 * installed agents behind the fold, and whether no AI was found at all. */
export function seatAgents(agents: AgentInfo[], detecting: boolean) {
  const featured = FEATURED.flatMap((id) => agents.filter((a) => a.id === id)).map((agent) => ({ agent, missing: !agent.installed }));
  const more = agents.filter((a) => a.installed && !FEATURED.includes(a.id));
  return { featured: detecting ? [] : featured, more: detecting ? [] : more, none: !detecting && !agents.some((a) => a.installed) };
}

type Props = {
  /** The session's number, shown in the header. */
  number: number;
  hidden?: boolean;
  focused?: boolean;
  /** The offered agents, installed or not (SESS-017). */
  agents: AgentInfo[];
  /** True until the first detection answers: then nothing is called missing. */
  detecting?: boolean;
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
  /** SESS-020: the saved shapes, the new list after a save, rename, delete or undo, and a pick. */
  saved: SavedShape[];
  onSaved: (list: SavedShape[]) => void;
  onPickSaved: (shape: SavedShape) => void;
  /** SESS-002: where the agent search stands; Start waits for a pass that succeeded. */
  pass?: AgentPass;
  onRefresh?: () => void;
  /** SESS-021: this project's last lineup, when it has one worth offering; applied only on the click. */
  lastLineup?: Lineup | null;
  onUseLineup?: () => void;
  /** SESS-019: the starter kit picked in this chooser (null for none), the pick or clear, and the AIs that can take kit roles. */
  kit?: string | null;
  onKit?: (kit: string | null) => void;
  vendors?: Vendor[];
};

export default function ChooserPane({ number, hidden = false, focused = false, agents, detecting = false, seats, onSeats, shape, onLineup, task, onTask, onStart, copies, inGit, onCopies, busy = false, closable, onClose, onFocus, saved, onSaved, onPickSaved, pass, onRefresh, lastLineup, onUseLineup, kit = null, onKit = () => {}, vendors = [] }: Props) {
  // SESS-019: a chosen kit folds Advanced (shape, count, folders) and takes the seats' place.
  const chosen = KITS.find((k) => k.id === kit) ?? null;
  const [unfold, setUnfold] = useState(false);
  const advanced = !chosen || unfold;
  const chooseKit = (id: string) => {
    setUnfold(false);
    onKit(id === kit ? null : id);
  };
  const roleAIs = chosen ? assignRoles(chosen, vendors) : [];
  const missingRole = chosen?.roles.find((_, i) => roleAIs[i] === null);
  const gap = chosen ? (missingRole ? `${missingRole.title} still needs an AI` : null) : seatGap(seats);
  const sessions = chosen ? chosen.roles.length : seats.length;
  const lineup = seatAgents(agents, detecting);
  // SESS-017: which seats show the folded agents; a seat already using one shows them anyway.
  const [unfolded, setUnfolded] = useState<number[]>([]);
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  // TERM-012: a chooser Kolux focuses takes the keyboard, so typing no longer lands in the last pane.
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focused && !hidden && !box.current?.contains(document.activeElement)) box.current?.focus();
  }, [focused, hidden]);
  // A program with no model list has nothing to pick: its seat uses the program's own default.
  const pickAgent = (i: number, id: string) => {
    const only = modelsFor(id).length === 1;
    setSeat(i, { agent: id, model: id !== TERMINAL && only ? DEFAULT_MODEL : null, effort: undefined, fast: undefined });
  };
  const setSeat = (i: number, patch: Partial<Seat>) => onSeats(seats.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const searched = !pass || canLaunch(pass);
  const ready = allReady(seats) && !busy && searched;
  const anyReady = seats.some(seatReady);
  // SESS-022: a line per provider near its limit, above Start; it never disables Start.
  const warnings = launchWarnings(seats.map((s) => s.agent), useLaunchUsage());
  const [naming, setNaming] = useState<string | null>(null); // the Save as team name field, open when set
  const [menu, setMenu] = useState<{ i: number; name: string } | null>(null); // a saved shape's rename/delete menu
  const [undo, setUndo] = useState<{ list: SavedShape[]; name: string } | null>(null); // the list before a delete
  const [problem, setProblem] = useState<string | null>(null);
  const undoTimer = useRef<number | null>(null);
  useEffect(() => () => void (undoTimer.current !== null && window.clearTimeout(undoTimer.current)), []);
  const save = () => {
    const out = saveShape(saved, naming ?? "", seats, copies, task);
    if ("error" in out) return setProblem(out.error);
    setProblem(null);
    setNaming(null);
    onSaved(out.list);
  };
  const remove = (i: number) => {
    setMenu(null);
    setUndo({ list: saved, name: saved[i].name });
    onSaved(saved.filter((_, j) => j !== i));
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), 8000);
  };
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
    <section ref={box} tabIndex={-1} className={`pane chooser${focused ? " focused" : ""}`} hidden={hidden} aria-label={`Session ${number} chooser`} onMouseDown={onFocus}>
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
        <p className="caption">{chosen ? "A kit gives each of its roles one of the AIs you have connected." : "Every seat starts blank. Kolux never picks an AI or a model for you."}</p>
        {pass?.error ? (
          <p className="caption warn" role="alert">
            Kolux could not look for agents ({pass.error}). Nothing can start until a search succeeds.
          </p>
        ) : pass && !pass.done ? (
          <p className="caption">Looking for agents…</p>
        ) : null}
        {lastLineup && onUseLineup && (
          <div className="count-row">
            <button className="btn" onClick={onUseLineup} title="Put back this project's last shape, folders choice and each seat's AI and model">
              {`Use last lineup: ${lineupAgents(lastLineup).map(nameOf).join(", ")}`}
            </button>
          </div>
        )}
        <div className="count-row" role="group" aria-label="Starter kits">
          <span className="label">Kits</span>
          {KITS.map((k) => (
            <button key={k.id} className="btn small" aria-pressed={k.id === kit} title={k.summary} onClick={() => chooseKit(k.id)}>
              <KitIcon id={k.id} size={13} />
              {k.title}
            </button>
          ))}
          <button className="btn link" onClick={() => openKits()}>
            See all kits
          </button>
        </div>
        <button className="btn link chooser-advanced" aria-expanded={advanced} onClick={() => setUnfold(!advanced)}>
          Advanced
        </button>
        {advanced && chosen && <p className="caption">A kit sets its own sessions; these apply once the kit is cleared.</p>}
        {advanced && (
        <>
        <div className="count-row" role="group" aria-label="Launch shape">
          <span className="label">Shape</span>
          {SHAPES.map((s) => (
            <button key={s.id} className="btn" aria-pressed={shape === s.id} title={s.roles.length ? s.roles.join(", ") : "No roles"} onClick={() => onLineup(s.id, pickShape(s.id, seats))}>
              {s.label}
            </button>
          ))}
          {saved.map((t, i) => (
            <span key={i} className="saved-shape" data-saved-shape={t.name}>
              <button className="btn" title={`${t.seats.length} seat${t.seats.length === 1 ? "" : "s"}: ${t.seats.map((x) => x.role ?? x.agent).join(", ")}`} onClick={() => onPickSaved(t)}>
                {t.name}
              </button>
              <button className="ib" title={`Rename or delete ${t.name}`} aria-expanded={menu?.i === i} onClick={() => setMenu(menu?.i === i ? null : { i, name: t.name })}>
                <Dots size={11} />
              </button>
            </span>
          ))}
          <button className="btn" disabled={!ready} title={ready ? "Save this lineup to pick again later" : "Pick an AI and a model (or Terminal) for every seat first"} onClick={() => setNaming(naming === null ? "" : null)}>
            Save as team
          </button>
        </div>
        {naming !== null && (
          <div className="count-row" role="group" aria-label="Save as team">
            <input className="seat-job" autoFocus type="text" maxLength={60} placeholder="Team name" aria-label="Team name" value={naming} onChange={(e) => setNaming(e.currentTarget.value)} onKeyDown={(e) => (e.key === "Enter" ? save() : e.key === "Escape" && setNaming(null))} />
            <button className="btn primary" disabled={!naming.trim()} onClick={save}>
              Save
            </button>
            <button className="btn" onClick={() => setNaming(null)}>
              Cancel
            </button>
          </div>
        )}
        {menu && saved[menu.i] && (
          <div className="count-row" role="group" aria-label={`Saved shape ${saved[menu.i].name}`}>
            <input className="seat-job" autoFocus type="text" maxLength={60} aria-label="New name" value={menu.name} onChange={(e) => setMenu({ ...menu, name: e.currentTarget.value })} onKeyDown={(e) => e.key === "Enter" && (onSaved(renameShape(saved, menu.i, menu.name)), setMenu(null))} />
            <button className="btn" onClick={() => (onSaved(renameShape(saved, menu.i, menu.name)), setMenu(null))}>
              Rename
            </button>
            <button className="btn danger" onClick={() => remove(menu.i)}>
              Delete
            </button>
          </div>
        )}
        {problem && (
          <div className="note warn" role="alert">
            {problem}
          </div>
        )}
        {undo && (
          <div className="note" role="status">
            Deleted {undo.name}.{" "}
            <button className="btn" onClick={() => (onSaved(undo.list), setUndo(null))}>
              Undo
            </button>
          </div>
        )}
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
        </>
        )}
        {chosen ? (
          <ul className="seats kit-roles" aria-label={`${chosen.title}: roles`}>
            {chosen.roles.map((r, i) => (
              <li key={r.id} className="seat">
                <span className="seat-title">{r.title}</span> <span className="caption">{roleAIs[i] ? VENDOR_NAME[roleAIs[i]!] : "No AI connected for this role"}</span>
              </li>
            ))}
          </ul>
        ) : (
        <>
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
                {detecting && !pass && <span className="caption">Looking for AI programs…</span>}
                {lineup.none && <span className="caption">No AI programs have been found yet.</span>}
                {lineup.featured.map(({ agent: a, missing }) => (
                  <span key={a.id} className="agent-card">
                    <label className={`choice${missing ? " missing" : ""}`} title={missing ? `${a.name} is not installed on this computer` : a.path ?? a.name}>
                      <input type="radio" name={`seat-${number}-${i}-ai`} checked={seat.agent === a.id} disabled={missing} onChange={() => pickAgent(i, a.id)} />
                      <VendorMark agent={markFor(a.id)} size={12} />
                      {a.name}
                      {missing && <span className="agent-missing">Not installed</span>}
                    </label>
                    {missing && (
                      <button className="btn link agent-link" onClick={() => openSettings("accounts")} aria-label={`Set up ${a.name}`}>
                        Set up
                      </button>
                    )}
                    {DOC_PAGES.includes(a.id) && (
                      <button className="btn link agent-link" onClick={() => void invoke("open_install_page", { agent: a.id }).catch(() => {})} aria-label={`${a.name} docs`} title={`Open ${a.name}'s own documentation`}>
                        Docs
                      </button>
                    )}
                  </span>
                ))}
                {lineup.more.length > 0 &&
                  (unfolded.includes(i) || lineup.more.some((a) => a.id === seat.agent) ? (
                    lineup.more.map((a) => (
                      <label key={a.id} className="choice" title={a.path ?? a.name}>
                        <input type="radio" name={`seat-${number}-${i}-ai`} checked={seat.agent === a.id} onChange={() => pickAgent(i, a.id)} />
                        <VendorMark agent={markFor(a.id)} size={12} />
                        {a.name}
                      </label>
                    ))
                  ) : (
                    <button className="btn link agent-link" onClick={() => setUnfolded((u) => [...u, i])}>
                      {`More agents (${lineup.more.length})`}
                    </button>
                  ))}
                <label className="choice">
                  <input type="radio" name={`seat-${number}-${i}-ai`} checked={seat.agent === TERMINAL} onChange={() => pickAgent(i, TERMINAL)} />
                  <VendorMark agent="shell" size={12} />
                  Terminal
                </label>
              </div>
              {seat.agent !== null && seat.agent !== TERMINAL && modelsFor(seat.agent).length === 0 && <span className="caption">Uses the program's default model</span>}
              {seat.agent !== null && modelsFor(seat.agent).length > 0 && (
                <div className="choices" role="radiogroup" aria-label={`Seat ${i + 1}: which model`}>
                  <span className="label">{seat.model === null ? "Pick a model" : "Model"}</span>
                  {modelsFor(seat.agent).map((m) => (
                    <label key={m.id} className="choice">
                      <input type="radio" name={`seat-${number}-${i}-model`} checked={seat.model === m.id} onChange={() => setSeat(i, { model: m.id, effort: undefined, fast: undefined })} />
                      {m.label}
                    </label>
                  ))}
                </div>
              )}
              {(choiceOf(seat)?.efforts || choiceOf(seat)?.fast) && (
                <div className="choices">
                  {choiceOf(seat)?.efforts && (
                    <label className="choice">
                      Effort
                      <select aria-label={`Seat ${i + 1}: effort`} value={seat.effort ?? ""} onChange={(e) => setSeat(i, { effort: e.currentTarget.value || undefined })}>
                        <option value="">Model default</option>
                        {choiceOf(seat)?.efforts?.map((l) => (
                          <option key={l} value={l}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {choiceOf(seat)?.fast && (
                    <label className="choice" title="Faster answers at a higher price per token">
                      <input type="checkbox" aria-label={`Seat ${i + 1}: fast mode`} checked={seat.fast === true} onChange={(e) => setSeat(i, { fast: e.currentTarget.checked || undefined })} />
                      Fast mode
                    </label>
                  )}
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
        </>
        )}
      </div>
      <footer className="chooser-foot">
        <div className="caption chooser-count" role="status">
          {`${sessions} ${sessions === 1 ? "session" : "sessions"}${gap ? ` · ${gap}` : ""}`}
        </div>
        {warnings.map((w) => (
          <div key={w} className="note warn" role="status">
            {w}
          </div>
        ))}
        <div className="btn-row">
          {onRefresh && (
            <button className="btn" disabled={pass?.looking} onClick={onRefresh} title="Look for installed agent CLIs again, for one you just installed">
              {pass?.looking ? "Looking…" : "Refresh agents"}
            </button>
          )}
          {chosen ? (
            <button className="btn primary" disabled={!!gap || busy} onClick={() => openKits(chosen.id, number)} title={gap ? "Connect an AI in Settings first" : "Open the kit's setup to give it its files"}>
              Set up kit
            </button>
          ) : (
          <button className="btn primary" disabled={!ready} onClick={() => onStart(seats)} title={ready ? "Start every seat" : !searched ? "Waiting for a search for agents that succeeds" : "Pick an AI and a model (or Terminal) for every seat first"}>
            {busy ? "Starting…" : `Start${seats.length > 1 ? ` ${seats.length}` : ""}`}
          </button>
          )}
        </div>
      </footer>
    </section>
  );
}
