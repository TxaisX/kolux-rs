// The chat view of one terminal-backed agent session (CHAT-006, CHAT-010; T-325): loading while
// the transcript is not written yet, then the conversation so far, then each new turn as the
// agent records it. Thin on purpose: the Agents screen (T-050) mounts it in its body.
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { locale } from "../language";
import "./chat.css";
import { applyRead, chatOffer, combine, lastReply, previewToShow, stamp, type ChatItem, type ChatRead, type Extra, type Offer, type Pending, type Preview, type Row } from "./model";

export type ChatPane = { key: number; cwd: string | null; title?: string };
type Support = { agent?: string; launching: boolean; readable: boolean };

export default function ChatView({ pane, preview = null, pending = [] }: { pane: ChatPane; preview?: Preview | null; pending?: Pending[] }) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [state, setState] = useState<ChatRead["state"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [extras, setExtras] = useState<Extra[]>([]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setItems([]);
    setState("loading");
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
    const off = listen<{ paneKey: number; reply?: string }>("agent-status", (e) => {
      if (e.payload.paneKey !== pane.key || !e.payload.reply) return;
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

  const rows = useMemo(() => combine(items, extras, previewToShow(preview, open, lastReply(items)), pending), [items, extras, preview, open, pending]);
  const [full, setFull] = useState<string | null>(null);

  return (
    <div className="chat" aria-label="Chat">
      {state === "loading" && rows.length === 0 && <div className="chat-state" role="status">Loading the conversation…</div>}
      {state === "error" && <div className="chat-state chat-error" role="alert">{error}</div>}
      {state === "empty" && rows.length === 0 && <div className="chat-state">No messages yet. What you and the agent say shows up here.</div>}
      <div className="chat-list">
        {rows.map((r) => (
          <ChatRow key={`${r.row}-${r.id}`} row={r} onImage={setFull} />
        ))}
      </div>
      {full && (
        <button type="button" className="chat-full" aria-label="Close image" onClick={() => setFull(null)}>
          <img src={full} alt="Attached" />
        </button>
      )}
    </div>
  );
}

function ChatRow({ row, onImage }: { row: Row; onImage: (src: string) => void }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (row.row === "preview") return <div className="chat-msg assistant preview"><div className="chat-text">{row.text}</div></div>;
  if (row.row === "pending") return <div className="chat-msg user pending"><div className="chat-text">{row.text}</div></div>;
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
      </div>
    </div>
  );
}

/** The Agents screen's chat until T-050's rail lands: the focused pane's chat when it can show
 * one, else the first pane that can. A pane still launching keeps the screen's placeholder (the
 * chooser is T-050's). */
export function AgentsChat({ panes, focused }: { panes: ChatPane[]; focused: number | null }) {
  const [offers, setOffers] = useState<Record<number, Offer>>({});
  const keys = panes.map((p) => p.key).join(",");
  useEffect(() => {
    let alive = true;
    const check = () =>
      Promise.all(panes.map((p) => invoke<Support>("chat_support", { paneKey: p.key }).then((s) => [p.key, chatOffer({ credited: s.agent, title: p.title, screen: "agents", switchOn: false, showingChat: false, launching: s.launching, readable: s.readable })] as const).catch(() => [p.key, { chat: false, back: false, chooser: false }] as const))).then((list) => {
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
  const pick = panes.find((p) => p.key === focused && offers[p.key]?.chat) ?? panes.find((p) => offers[p.key]?.chat);
  // Shown before the screen's placeholder, which `.chat + .empty` then hides.
  if (!pick) return null;
  return <ChatView pane={pick} />;
}
