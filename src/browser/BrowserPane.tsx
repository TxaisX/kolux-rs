// A browser tab (BROW-001, BROW-002, BROW-003, BROW-005). The page itself is a child web view the back end lays
// over this pane's body; this component only reports where the body is and whether it is on
// screen, so the page lives on untouched while its tab, workspace or screen is away. The header
// holds the address bar, which takes the cursor with its text selected as the tab opens, and
// the back / forward / reload toolbar; what the bar makes of typed text is in address.ts.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ArrowLeft, ArrowRight, Close, Globe, Refresh, Stop } from "../chrome/icons";
import { BLANK, resolveAddress } from "./address";

type Props = { id: number; title?: string; hidden?: boolean; focused?: boolean; onFocus?: () => void; onClose?: () => void };

/** The pane body's place in the window, in CSS pixels, as the back end places the page. */
function spot(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

export default function BrowserPane({ id, title, hidden = false, focused = false, onFocus, onClose }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const opened = useRef(false);
  const [address, setAddress] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [can, setCan] = useState({ back: false, forward: false });
  // ponytail: wry has no can-go-back, so history is tracked from this tab's own actions and the
  // page loads it sees: a load that starts before the last one finished is a redirect, so it
  // replaces the entry instead of adding one. A page's own history.back() or pushState still
  // drifts it. Upgrade when wry exposes navigation history.
  const hist = useRef({ urls: [BLANK], at: 0, busy: false });
  const pending = useRef<"back" | "forward" | "same" | null>(null);

  useEffect(() => {
    let alive = true;
    const unlisteners: UnlistenFn[] = [];
    (async () => {
      unlisteners.push(
        await listen<{ id: number; event: string; url: string }>("browser-load", (e) => {
          if (e.payload.id !== id) return;
          const h = hist.current;
          if (e.payload.event !== "started") {
            h.busy = false;
            return setLoading(false);
          }
          const { url } = e.payload;
          const p = pending.current;
          pending.current = null;
          if (p === "back") h.at = Math.max(0, h.at - 1);
          else if (p === "forward") h.at = Math.min(h.urls.length - 1, h.at + 1);
          else if (h.busy) h.urls[h.at] = url;
          else if (p !== "same" && url !== h.urls[h.at]) {
            h.urls = [...h.urls.slice(0, h.at + 1), url];
            h.at = h.urls.length - 1;
          }
          h.busy = true;
          setCan({ back: h.at > 0, forward: h.at < h.urls.length - 1 });
          setLoading(true);
          setAddress(url === BLANK ? "" : url);
        }),
      );
      if (!alive) return;
      try {
        await invoke("browser_open", { id, url: BLANK, spot: spot(host.current!) });
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
      <div ref={host} className="pane-body" />
    </section>
  );
}
