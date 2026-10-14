// The chat view of one terminal-backed agent session (CHAT-006, CHAT-010; T-325): loading while
// the transcript is not written yet, then the conversation so far, then each new turn as the
// agent records it, with the agent's work folded into steps, diff cards and a subagent roster
// (T-326). Thin on purpose: the Agents screen (T-050) mounts it in its body.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { locale } from "../language";
import "./chat.css";
import { fold, thoughtIds as idsOf, toggled, type View } from "./steps";
import { NoticeRow, PlanRow, StepRow, ThoughtRow } from "./StepRows";
import { applyRead, capPending, chatOffer, combine, pickChat, lastReply, previewToShow, stamp, type ChatItem, type ChatRead, type Extra, type Offer, type Pending, type Preview, type Row } from "./model";
import { Composer, type ComposerHandle } from "./MessageBox";
import { ASKING_NOTE, asksInTerminal, enqueue, forwardsToBox, nearBottom, sendSteps, typeSteps } from "./composer";

/** `terminal`: the program session the pane types into (the window's own pane-to-terminal map). */
export type ChatPane = { key: number; cwd: string | null; title?: string; terminal?: number };
type Support = { agent?: string; launching: boolean; readable: boolean };

/** `hookState`: the window's hook reading for the pane (permission, waiting, working, ...), when it has one. */
export default function ChatView({ pane, agent, preview = null, pending = [], hookState }: { pane: ChatPane; agent?: string; preview?: Preview | null; pending?: Pending[]; hookState?: string }) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [state, setState] = useState<ChatRead["state"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [extras, setExtras] = useState<Extra[]>([]);
  // CHAT-022: while the agent shows a permission or question menu in its terminal, nothing is
  // typed from the chat: a send's keys would land in the menu and its Enter would pick the default.
  const heard = useRef<string | undefined>(undefined);
  const [heardState, setHeard] = useState<string | undefined>(undefined);
  const asking = asksInTerminal(hookState ?? heardState);
  const askingNow = useRef(asking);
  askingNow.current = asking;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setItems([]);
    setState("loading");
    heard.current = undefined;
    setHeard(undefined);
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
      // CHAT-022: the hooks' own reading, kept at once so a send already under way sees it.
      if (e.payload.state !== undefined) {
        heard.current = e.payload.state;
        setHeard(e.payload.state);
      }
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
  const terminal = pane.terminal;
  const send = (text: string) => {
    if (terminal === undefined || askingNow.current) return;
    const id = `sent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setSent((xs) => capPending([...xs, { id, text, at: Date.now() }]));
    stick.current = true;
    const failed = () => setSent((xs) => xs.map((x) => (x.id === id ? { ...x, failed: true } : x)));
    // CHAT-022: a menu that opens mid-send drops the rest of the keys, the Enter above all.
    const stop = () => askingNow.current || asksInTerminal(heard.current);
    enqueue(terminal, () => typeSteps(sendSteps(agent, text), (data) => invoke("terminal_write", { id: terminal, data }), undefined, stop)).then((done) => {
      if (!done) failed();
    }, failed);
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
    <div className="chat" aria-label="Chat" onKeyDown={onKeyDown}>
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
      <Composer ref={box} paneKey={pane.key} live={terminal !== undefined} blocked={asking ? ASKING_NOTE : undefined} onSend={send} />
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
 * window's hook readings by pane, so the box holds its send while the agent asks in its terminal. */
export function AgentsChat({ panes, focused, ptyOf, hook }: { panes: ChatPane[]; focused: number | null; ptyOf?: (key: number) => number | undefined; hook?: Record<number, string | undefined> }) {
  const [offers, setOffers] = useState<Record<number, Offer & { agent?: string }>>({});
  const keys = panes.map((p) => p.key).join(",");
  useEffect(() => {
    let alive = true;
    const check = () =>
      Promise.all(panes.map((p) => invoke<Support>("chat_support", { paneKey: p.key }).then((s) => [p.key, { agent: s.agent, ...chatOffer({ credited: s.agent, title: p.title, screen: "agents", switchOn: false, showingChat: false, launching: s.launching, readable: s.readable }) }] as const).catch(() => [p.key, { chat: false, back: false, chooser: false }] as const))).then((list) => {
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
  // Shown before the screen's placeholder, which `.chat + .empty` then hides.
  if (shown === null) return null;
  if (shown === "starting")
    return (
      <div className="chat" aria-label="Chat">
        <div className="chat-state" role="status">Starting…</div>
      </div>
    );
  return <ChatView pane={{ ...shown, terminal: shown.terminal ?? ptyOf?.(shown.key) }} agent={offers[shown.key]?.agent} hookState={hook?.[shown.key]} />;
}
