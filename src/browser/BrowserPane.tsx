// A browser tab (BROW-001, BROW-002, BROW-003, BROW-005). The page itself is a child web view the back end lays
// over this pane's body; this component only reports where the body is and whether it is on
// screen, so the page lives on untouched while its tab, workspace or screen is away. The header
// holds the address bar, which takes the cursor with its text selected as the tab opens, and
// the back / forward / reload toolbar; what the bar makes of typed text is in address.ts.
// BROW-037: Annotate turns element picking on in the page; each saved note lands in the tray
// under the header, where it can be edited or removed, and Send hands them all to one agent
// session as a single Markdown message (notes.ts). A new address empties the tray.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ArrowLeft, ArrowRight, Close, Globe, Refresh, Stop, Target } from "../chrome/icons";
import { BLANK, resolveAddress } from "./address";
import { can as canGo, fresh, started, type Pending } from "./history";
import { CAP, notesMarkdown, type Note } from "./notes";

/** An agent session a page's notes can go to (BROW-037). */
export type Session = { key: number; name: string };
/** `url`: the page or file the tab opens on instead of a blank page (SKILL-012 previews a kit result). */
type Props = { id: number; url?: string; title?: string; hidden?: boolean; focused?: boolean; sessions?: Session[]; onSend?: (key: number, text: string) => void; onFocus?: () => void; onClose?: () => void };

/** The pane body's place in the window, in CSS pixels, as the back end places the page. */
/** GIT-036: asks the window for a new browser tab at `url` in the focused split. */
export const OPEN_IN_BROWSER = "kolux-open-in-browser";
export const openInBrowser = (url: string) => window.dispatchEvent(new CustomEvent(OPEN_IN_BROWSER, { detail: url }));

function spot(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

export default function BrowserPane({ id, url, title, hidden = false, focused = false, sessions = [], onSend, onFocus, onClose }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const opened = useRef(false);
  const [address, setAddress] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [can, setCan] = useState({ back: false, forward: false });
  const [picking, setPicking] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [sendMenu, setSendMenu] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  // ponytail: wry has no can-go-back, so history is tracked from this tab's own actions and the
  // page loads it sees (history.ts). The chords pressed inside the page come back through the
  // app (T-012-b-fix), so the web view never goes back on its own; a page's pushState still
  // drifts it. Upgrade when wry exposes navigation history.
  const hist = useRef(fresh());
  const pending = useRef<Pending>(null);

  useEffect(() => {
    let alive = true;
    const unlisteners: UnlistenFn[] = [];
    // A listener that arrives after the effect was cleaned up (StrictMode mounts twice in
    // development) is dropped at once, or every event would be handled twice.
    const add = (u: UnlistenFn): void => { if (alive) unlisteners.push(u); else u(); };
    (async () => {
      add(
        await listen<{ id: number; event: string; url: string }>("browser-load", (e) => {
          if (e.payload.id !== id) return;
          if (e.payload.event !== "started") {
            hist.current.busy = false;
            return setLoading(false);
          }
          const { url } = e.payload;
          setAddress((was) => {
            // BROW-037: a new address drops the page's notes and ends picking (the page is gone).
            if (url !== was && !(url === BLANK && was === "")) {
              setNotes([]);
              setPicking(false);
              setEditing(null);
              setSent(null);
            }
            return was;
          });
          const h = started(hist.current, pending.current, url);
          pending.current = null;
          hist.current = h;
          setCan(canGo(h));
          setLoading(true);
          setAddress(url === BLANK ? "" : url);
        }),
      );
      add(
        await listen<{ id: number; note: Note }>("browser-note", (e) => {
          if (e.payload.id !== id) return;
          setNotes((ns) => (ns.length >= CAP ? ns : [...ns, e.payload.note]));
          setSent(null);
        }),
      );
      if (!alive) return;
      try {
        const first = url ? resolveAddress(url) : null;
        await invoke("browser_open", { id, url: first && "url" in first ? first.url : BLANK, spot: spot(host.current!) });
        opened.current = true;
        if (alive) {
          setOpen(true);
          bar.current?.focus(); // BROW-001: the cursor is in the address bar once the page exists
        }
        else invoke("browser_close", { id }).catch(() => {});
      } catch (err) {
        setNote(String(err));
      }
    })();
    return () => {
      alive = false;
      unlisteners.forEach((u) => u());
      if (opened.current) invoke("browser_close", { id }).catch(() => {});
    };
  }, [id]);

  // BROW-002: away means covered, never torn down. The page follows the body's spot whenever it
  // moves or changes size (a split, the sidebar, the window) and hides while the tab is away.
  useEffect(() => {
    if (!open) return;
    const el = host.current!;
    const send = () => {
      const shown = !hidden && el.clientWidth > 0 && el.clientHeight > 0;
      invoke("browser_bounds", { id, spot: shown ? spot(el) : { x: 0, y: 0, w: 0, h: 0 }, shown }).catch(() => {});
    };
    send();
    const observer = new ResizeObserver(send);
    observer.observe(el);
    window.addEventListener("resize", send);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", send);
    };
  }, [id, open, hidden]);

  // BROW-003: Enter reads the bar; an invalid address is said in the notice and the page stays.
  const go = () => {
    const r = resolveAddress(address);
    if ("error" in r) return setNote(r.error);
    setNote(null);
    pending.current = null;
    invoke("browser_navigate", { id, url: r.url }).catch((err) => setNote(String(err)));
  };
  // BROW-037: element picking in the page, on or off; Escape inside a note's form in the page
  // ends only that form (the page script keeps picking on).
  const pick = (on: boolean) => {
    setPicking(on);
    invoke("browser_annotate", { id, on }).catch((err) => setNote(String(err)));
  };
  const send = (key: number) => {
    const text = notesMarkdown(notes);
    setSendMenu(false);
    if (!text || !onSend) return;
    onSend(key, text);
    setSent(`${notes.length} ${notes.length === 1 ? "note" : "notes"} sent to ${sessions.find((s) => s.key === key)?.name ?? "the session"}`);
    setNotes([]);
    setEditing(null);
  };
  const saveEdit = (i: number) => {
    setNotes((ns) => ns.map((n, j) => (j === i ? { ...n, comment: draft.trim() } : n)));
    setEditing(null);
  };
  // BROW-005: the toolbar; a reload is the same page, so it leaves the history alone.
  const act = (what: "back" | "forward" | "reload" | "stop") => {
    pending.current = what === "reload" ? "same" : what === "stop" ? null : what;
    invoke("browser_go", { id, what }).catch((err) => setNote(String(err)));
  };

  return (
    <section className={`pane browser${focused ? " focused" : ""}`} hidden={hidden} aria-label={`${title ?? "New Tab"} pane`} onMouseDown={onFocus} data-kind="browser" data-key={id}>
      <header className="pane-head">
        <span className="agent-mark" title="Browser">
          <Globe size={13} />
        </span>
        <span className="title">{title ?? "New Tab"}</span>
        <button className="ib" data-go="back" disabled={!can.back} onClick={() => act("back")} title="Back (Alt+Left)" aria-label="Back">
          <ArrowLeft size={12} />
        </button>
        <button className="ib" data-go="forward" disabled={!can.forward} onClick={() => act("forward")} title="Forward (Alt+Right)" aria-label="Forward">
          <ArrowRight size={12} />
        </button>
        {loading ? (
          <button className="ib loading" data-go="stop" onClick={() => act("stop")} title="Stop loading" aria-label="Stop">
            <Stop size={12} />
          </button>
        ) : (
          <button className="ib" data-go="reload" onClick={() => act("reload")} title="Reload (Ctrl+R)" aria-label="Reload">
            <Refresh size={12} />
          </button>
        )}
        <input
          ref={bar}
          className="address"
          aria-label="Address"
          placeholder="Address"
          value={address}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setAddress(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") go();
          }}
        />
        <span className="right">
          <button className={`ib${picking ? " on" : ""}`} aria-pressed={picking} onClick={() => pick(!picking)} title={picking ? "Stop annotating" : "Annotate page element"} aria-label="Annotate page element">
            <Target size={12} />
          </button>
          <button className="ib" onClick={onClose} title="Close tab (Ctrl+W)">
            <Close size={12} />
          </button>
        </span>
      </header>
      {note && (
        <div className="notice" role="alert">
          {note}
        </div>
      )}
      {(notes.length > 0 || picking || sent) && (
        <div className="notes-tray" role="region" aria-label="Page notes">
          {picking && notes.length === 0 && !sent && <span className="notes-hint">Click an element in the page, write what should change, then Save.</span>}
          {sent && notes.length === 0 && <span className="notes-hint">{sent}</span>}
          {notes.map((n, i) => (
            <div className="page-note" key={n.at + i}>
              <span className="note-sel" title={n.selector}>
                {n.intent}: {n.selector}
              </span>
              {editing === i ? (
                <>
                  <textarea
                    className="note-edit"
                    aria-label="Note comment"
                    value={draft}
                    autoFocus
                    rows={2}
                    onChange={(e) => setDraft(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditing(null);
                      if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), saveEdit(i));
                    }}
                  />
                  <button className="btn" onClick={() => saveEdit(i)}>
                    Save
                  </button>
                  <button className="btn" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span className="note-text">{n.comment || "(no comment)"}</span>
                  <button className="btn" onClick={() => (setDraft(n.comment), setEditing(i))}>
                    Edit
                  </button>
                  <button className="btn" onClick={() => setNotes((ns) => ns.filter((_, j) => j !== i))} aria-label="Remove note">
                    Remove
                  </button>
                </>
              )}
            </div>
          ))}
          {notes.length > 0 && (
            <span className="notes-send">
              <button className="btn primary" aria-haspopup="menu" aria-expanded={sendMenu} disabled={sessions.length === 0} onClick={() => setSendMenu((m) => !m)} title={sessions.length ? "Send the notes to an agent session" : "No agent session is running"}>
                Send {notes.length} {notes.length === 1 ? "note" : "notes"}
              </button>
              {sendMenu && (
                <>
                  <div className="menu-backdrop" onMouseDown={() => setSendMenu(false)} />
                  <div className="menu notes-menu" role="menu">
                    <div className="menu-title">Send to</div>
                    {sessions.map((s) => (
                      <button key={s.key} role="menuitem" className="menu-item" onClick={() => send(s.key)}>
                        <span className="name">{s.name}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </span>
          )}
        </div>
      )}
      <div ref={host} className="pane-body" />
    </section>
  );
}
