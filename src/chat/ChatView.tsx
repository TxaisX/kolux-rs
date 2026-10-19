// The chat view of one terminal-backed agent session (CHAT-006, CHAT-010; T-325): loading while
// the transcript is not written yet, then the conversation so far, then each new turn as the
// agent records it, with the agent's work folded into steps, diff cards and a subagent roster
// (T-326). Thin on purpose: the Agents screen (T-050) mounts it in its body; AgentsChat (T-050-b)
// decides chat or terminal and carries the Show terminal switch; a finished turn's reply can be
// handed to another session's box (T-080).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { locale } from "../language";
import "./chat.css";
import { fold, thoughtIds as idsOf, toggled, type View } from "./steps";
import { NoticeRow, PlanRow, StepRow, ThoughtRow } from "./StepRows";
import { SHELL_OFFER, agentsView, handInto, handTargets, handText, viewedFirst, applyRead, capPending, chatCovers, chatOffer, combine, pickChat, typingInto, lastReply, previewToShow, stamp, type ChatItem, type ChatRead, type Extra, type Offer, type Pending, type Preview, type Row } from "./model";
import { Composer, type ComposerHandle } from "./MessageBox";
import { draftOf, forwardsToBox, keepDraft, nearBottom } from "./composer";
import { sessionLabel } from "../agents/rail";
import { boxSend, hearStates, holdReading, writeTerminal } from "./send";

/** `terminal`: the program session the pane types into (the window's own pane-to-terminal map).
 * `program`: what Kolux started in the pane; null for a plain shell (T-050-b: no chat, no switch). */
export type ChatPane = { key: number; cwd: string | null; title?: string; terminal?: number; program?: string | null };
type Support = { agent?: string; launching: boolean; readable: boolean };

/** `hookState`: the window's hook reading for the pane (permission, waiting, working, ...), when it has
 * one; `stateOf`: the same readings read live by pane key, so a send checks its own pane at every write.
 * `ptyOf`: the pane's program session, asked at send time. `target`: names the pane the box types into.
 * `aside`: drawn at the top right (the Agents screen's Show terminal switch). `hand`: VIEW-020, the
 * sessions a finished turn's reply can be handed to, and what handing it does. */
export type Hand = { targets: { key: number; label: string }[]; onHand: (key: number, text: string) => void };
export default function ChatView({ pane, agent, preview = null, pending = [], hookState, stateOf, ptyOf, target = null, aside, hand }: { pane: ChatPane; agent?: string; preview?: Preview | null; pending?: Pending[]; hookState?: string; stateOf?: (key: number) => string | undefined; ptyOf?: (key: number) => number | undefined; target?: string | null; aside?: ReactNode; hand?: Hand }) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [state, setState] = useState<ChatRead["state"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [extras, setExtras] = useState<Extra[]>([]);
  // CHAT-022 (council FIX-1): the box sends only while Kolux can see the agent is not asking in its
  // terminal; a send's keys would land in a menu and its Enter would pick the default (Yes).
  // `setHeard` only redraws the box when the pane's hook event arrives; the reading itself is send.ts's.
  const [, setHeard] = useState<string | undefined>(undefined);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => void hearStates(listen).catch(() => {}), []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setItems([]);
    setState("loading");
    setHeard(undefined);
    setNote(null);
    const look = () => {
      invoke<ChatRead>("chat_read", { paneKey: pane.key })
        .then((r) => {
          if (!alive) return;
          setItems((prev) => applyRead(prev, r));
          setState(r.state);
          setError(r.error ?? null);
          setOpen(r.open);
          timer = setTimeout(look, r.retryMs);
        })
        .catch((e) => {
          if (!alive) return;
          setState("error");
          setError(String(e));
          timer = setTimeout(look, 10_000);
        });
    };
    look();
    // CHAT-010: what the hooks say arrives first; the transcript's version replaces it.
    const off = listen<{ paneKey: number; reply?: string; state?: string }>("agent-status", (e) => {
      if (e.payload.paneKey !== pane.key) return;
      // CHAT-022: the hooks' own reading, for the box's note (a send reads it live through send.ts).
      if (e.payload.state !== undefined) setHeard(e.payload.state);
      if (!e.payload.reply) return;
      const text = e.payload.reply;
      setExtras((xs) => (xs.some((x) => x.text === text) ? xs : [...xs.slice(-20), { id: `hook-${Date.now()}`, role: "assistant", text, at: Date.now() }]));
    });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      void off.then((u) => u()).catch(() => {});
      invoke("chat_close", { paneKey: pane.key }).catch(() => {});
    };
  }, [pane.key]);

  // CHAT-020: what this view sent and the transcript has not confirmed yet (at most 8 per pane).
  const [sent, setSent] = useState<Pending[]>([]);
  useEffect(() => setSent([]), [pane.key]);
  const allPending = useMemo(() => capPending([...pending, ...sent]), [pending, sent]);
  const rows = useMemo(() => combine(items, extras, previewToShow(preview, open, lastReply(items)), allPending), [items, extras, preview, open, allPending]);
  const key = pane.key;
  const terminalOf = (k: number) => (k === key && pane.terminal !== undefined ? pane.terminal : ptyOf?.(k));
  // Council FIX-2: a reading from the pane's earlier terminal does not count (FS4).
  const held = holdReading(key, hookState, stateOf !== undefined, terminalOf(key));
  /** False when nothing was sent, so the box keeps the text; the box then says why (council FIX-2, FS3). */
  const send = (text: string): boolean => {
    const id = `sent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const failed = () => setSent((xs) => xs.map((x) => (x.id === id ? { ...x, failed: true } : x)));
    // CHAT-022: the send is bound to this pane; a menu it opens mid-send drops the rest, the Enter above all.
    return boxSend(key, agent, text, { terminalOf, stateOf, write: writeTerminal }, {
      note: setNote,
      onQueued: () => {
        setSent((xs) => capPending([...xs, { id, text, at: Date.now() }]));
        stick.current = true;
      },
      onFailed: failed,
    });
  };
  // CHAT-027: within 48 px of the bottom the view follows new output; further up it holds still.
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [away, setAway] = useState(false);
  const onScroll = () => {
    const el = list.current;
    if (!el) return;
    stick.current = nearBottom(el);
    setAway(!stick.current);
  };
  const toBottom = () => {
    const el = list.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stick.current = true;
    setAway(false);
  };
  const box = useRef<ComposerHandle>(null);
  // T-050-b: once the chat covers the terminal, keys must not keep going to the hidden terminal.
  const covers = chatCovers(state);
  // VIEW-020: a finished session's result, the last reply once the turn is over.
  const result = !open && hand && hand.targets.length > 0 ? lastReply(items) : undefined;
  useEffect(() => {
    if (covers && document.activeElement?.closest(".grid.agents")) box.current?.focus();
  }, [covers]);
  // CHAT-017: typing anywhere in the chat pane goes to the box; Backspace or Delete moves focus there.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest("textarea, input, select, [contenteditable]")) return;
    if (t.closest("button, a") && (e.key === " " || e.key === "Enter")) return;
    if (forwardsToBox({ key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, isComposing: e.nativeEvent.isComposing })) box.current?.focus();
  };
  const views = useMemo(() => fold(rows, open), [rows, open]);
  useLayoutEffect(() => {
    if (stick.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [views]);
  const [full, setFull] = useState<string | null>(null);
  // STAT-053: Thought rows start folded; the toolbar opens or folds them all.
  const [thoughts, setThoughts] = useState<Set<string>>(() => new Set());
  const thoughtIds = idsOf(items);
  const toggle = (id: string) => setThoughts((t) => toggled(t, id));

  return (
    <div className={`chat${covers ? " cover" : ""}`} aria-label="Chat" onKeyDown={onKeyDown}>
      {(aside || result) && (
        <div className="chat-head">
          {result && hand && <HandOff targets={hand.targets} onPick={(k) => hand.onHand(k, result)} />}
          {aside}
        </div>
      )}
      {state === "loading" && rows.length === 0 && <div className="chat-state" role="status">Loading the conversation…</div>}
      {state === "error" && <div className="chat-state chat-error" role="alert">{error}</div>}
      {state === "empty" && rows.length === 0 && <div className="chat-state">No messages yet. What you and the agent say shows up here.</div>}
      {thoughtIds.length > 0 && (
        <div className="chat-toolbar">
          <button type="button" onClick={() => setThoughts(new Set(thoughtIds))}>Expand all</button>
          <button type="button" onClick={() => setThoughts(new Set())}>Collapse all</button>
        </div>
      )}
      <div className="chat-list" ref={list} onScroll={onScroll}>
        {views.map((v) => (
          <ViewRow key={`${v.row}-${v.id}`} view={v} onImage={setFull} thoughts={thoughts} onToggle={toggle} />
        ))}
      </div>
      {away && (
        <button type="button" className="chat-jump" onClick={toBottom}>
          Jump to latest
        </button>
      )}
      {target && <div className="chat-target" role="status">{target}</div>}
      <Composer ref={box} paneKey={pane.key} live={terminalOf(key) !== undefined} blocked={held} note={note ?? undefined} onSend={send} />
      {full && (
        <button type="button" className="chat-full" aria-label="Close image" onClick={() => setFull(null)}>
          <img src={full} alt="Attached" />
        </button>
      )}
    </div>
  );
}

function ViewRow({ view, onImage, thoughts, onToggle }: { view: View; onImage: (src: string) => void; thoughts: Set<string>; onToggle: (id: string) => void }) {
  if (view.row !== "message") return view.row === "preview" || view.row === "pending" ? <ChatRow row={view} onImage={onImage} /> : <StepRow view={view} />;
  if (view.kind === "thought") return <ThoughtRow item={view} open={thoughts.has(view.id)} onToggle={() => onToggle(view.id)} />;
  if (view.kind === "plan") return <PlanRow item={view} />;
  if (view.kind === "notice") return <NoticeRow item={view} />;
  if (view.kind === "compact") return <div className="chat-divider" role="separator"><span>{view.text}</span></div>;
  return <ChatRow row={view} onImage={onImage} />;
}

function ChatRow({ row, onImage }: { row: Row; onImage: (src: string) => void }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (row.row === "preview") return <div className="chat-msg assistant preview"><div className="chat-text">{row.text}</div></div>;
  if (row.row === "pending")
    return (
      <div className={`chat-msg user pending${row.failed ? " failed" : ""}`}>
        <div className="chat-text">{row.text}</div>
        {row.failed && <div className="chat-fail" role="alert">This message did not arrive. Look at the terminal.</div>}
      </div>
    );
  if (row.role === "status") return <div className="chat-status" role="status">{row.text}</div>;
  const when = row.at !== undefined ? stamp(row.at, locale()) : null;
  const copy = () => {
    navigator.clipboard.writeText(row.text).then(() => {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    }, () => {});
  };
  return (
    <div className={`chat-msg ${row.role}${row.kind === "command" ? " command" : ""}`}>
      {row.images && row.images.length > 0 && (
        <div className="chat-images">
          {row.images.map((src, i) => (
            <button key={i} type="button" className="chat-thumb" aria-label="Open image at full size" onClick={() => onImage(src)}>
              <img src={src} alt="Attached" />
            </button>
          ))}
        </div>
      )}
      {row.text && <div className="chat-text">{row.text}</div>}
      <div className="chat-meta">
        {when && <time title={when.full}>{when.short}</time>}
        <button type="button" className="chat-copy" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
        <button type="button" className="chat-copy" title="Bring this message to the top" onClick={(e) => e.currentTarget.closest(".chat-msg")?.scrollIntoView({ block: "start" })}>
          Top
        </button>
      </div>
    </div>
  );
}

/** The Agents screen's chat: the picked pane's chat when it can show one (`pickChat`). `hook`: the
 * window's hook readings by pane, for the box's note; `stateOf`: the same readings read live, so a
 * send stops on its own pane's menu even after the screen moved to another pane. */
export function AgentsChat({ panes, focused, ptyOf, hook, stateOf, onPick }: { panes: ChatPane[]; focused: number | null; ptyOf?: (key: number) => number | undefined; hook?: Record<number, string | undefined>; stateOf?: (key: number) => string | undefined; onPick?: (key: number) => void }) {
  const [offers, setOffers] = useState<Record<number, Offer & { agent?: string }>>({});
  // VIEW-019 (T-050-b): the sessions the user flipped to their terminal, kept while the screen is open.
  const [forced, setForced] = useState<ReadonlySet<number>>(() => new Set());
  const flip = (key: number, on: boolean) =>
    setForced((s) => {
      const next = new Set(s);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const keys = panes.map((p) => p.key).join(",");
  useEffect(() => {
    let alive = true;
    const check = () =>
      Promise.all(panes.map((p) => (p.program === null ? Promise.resolve([p.key, SHELL_OFFER] as const) : invoke<Support>("chat_support", { paneKey: p.key }).then((s) => [p.key, { agent: s.agent, ...chatOffer({ credited: s.agent, title: p.title, screen: "agents", switchOn: false, showingChat: false, launching: s.launching, readable: s.readable }) }] as const).catch(() => [p.key, { chat: false, back: false, chooser: false }] as const)))).then((list) => {
        if (alive) setOffers(Object.fromEntries(list));
      });
    void check();
    const t = setInterval(check, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);
  const shown = pickChat(panes, focused, offers);
  // VIEW-020: the sessions in the order last viewed, for the hand-off list.
  const [viewed, setViewed] = useState<number[]>([]);
  const shownKey = typeof shown === "object" && shown ? shown.key : null;
  useEffect(() => {
    if (shownKey !== null) setViewed((v) => (v[0] === shownKey ? v : viewedFirst(v, shownKey)));
  }, [shownKey]);
  const view = agentsView(shown, forced);
  // Shown before the screen's placeholder, which `.chat + .empty` then hides; `.chat.cover` hides
  // the terminal after it (the terminal stays mounted, so flipping back never restarts it).
  if (view === "none" || shown === null) return null;
  if (view === "starting" || shown === "starting")
    return (
      <div className="chat" aria-label="Chat">
        <div className="chat-state" role="status">Starting…</div>
      </div>
    );
  const key = shown.key;
  if (view === "terminal")
    return (
      <div className="chat-switchbar">
        <TerminalSwitch on onFlip={(on) => flip(key, on)} />
      </div>
    );
  // VIEW-020: the result goes into the target's kept draft after what is typed there, then the
  // screen moves to the target, whose box opens with it.
  const hand: Hand = {
    targets: handTargets(panes, key, offers, viewed).map((p) => ({ key: p.key, label: sessionLabel(p) })),
    onHand: (to, text) => {
      keepDraft(to, handInto(draftOf(to), handText(text)));
      onPick?.(to);
    },
  };
  return <ChatView key={key} pane={shown} agent={offers[key]?.agent} hookState={hook?.[key]} stateOf={stateOf} ptyOf={ptyOf} target={typingInto(focused, shown)} aside={<TerminalSwitch on={false} onFlip={(on) => flip(key, on)} />} hand={hand} />;
}

/** VIEW-019: the Show terminal switch: on, the session's raw terminal shows in place of its chat. */
export function TerminalSwitch({ on, onFlip }: { on: boolean; onFlip: (on: boolean) => void }) {
  return (
    <label className="chat-switch">
      <input type="checkbox" role="switch" checked={on} aria-checked={on} onChange={(e) => onFlip(e.currentTarget.checked)} />
      Show terminal
    </label>
  );
}

/** VIEW-020: Send result to, a short list of other chat sessions (the last viewed first). */
export function HandOff({ targets, onPick }: { targets: { key: number; label: string }[]; onPick: (key: number) => void }) {
  return (
    <details className="chat-hand">
      <summary>Send result to…</summary>
      <ul aria-label="Sessions to send the result to">
        {targets.map((t) => (
          <li key={t.key}>
            <button type="button" onClick={(e) => {
              e.currentTarget.closest("details")?.removeAttribute("open");
              onPick(t.key);
            }}>{t.label}</button>
          </li>
        ))}
      </ul>
    </details>
  );
}
