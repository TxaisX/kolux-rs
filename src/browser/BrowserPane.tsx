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
import { backgroundBehind } from "./colour";
import "./browser.css";
import { can as canGo, fresh, started, type Pending } from "./history";
import { zoomFactor } from "../settings/zoom";

/** `url`: the page or file the tab opens on instead of a blank page (SKILL-012 previews a kit result). */
type Props = { id: number; url?: string; title?: string; hidden?: boolean; focused?: boolean; onFocus?: () => void; onClose?: () => void };

/** The pane body's place in the window, in CSS pixels, as the back end places the page. */
/** GIT-036: asks the window for a new browser tab at `url` in the focused split. */
export const OPEN_IN_BROWSER = "kolux-open-in-browser";
export const openInBrowser = (url: string) => window.dispatchEvent(new CustomEvent(OPEN_IN_BROWSER, { detail: url }));

function spot(el: HTMLElement) {
  // SET-019: the window places the page in unzoomed pixels, so a zoomed rect is scaled back.
  const r = el.getBoundingClientRect();
  const z = zoomFactor();
  return { x: r.left * z, y: r.top * z, w: r.width * z, h: r.height * z };
}

export default function BrowserPane({ id, url, title, hidden = false, focused = false, onFocus, onClose }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const opened = useRef(false);
  const [address, setAddress] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [can, setCan] = useState({ back: false, forward: false });
  // ponytail: wry has no can-go-back, so history is tracked from this tab's own actions and the
  // page loads it sees (history.ts). The chords pressed inside the page come back through the
  // app (T-012-b-fix), so the web view never goes back on its own; a page's pushState still
  // drifts it. Upgrade when wry exposes navigation history.
  const hist = useRef(fresh());
  const pending = useRef<Pending>(null);

  useEffect(() => {
    let alive = true;
    const unlisteners: UnlistenFn[] = [];
    (async () => {
      unlisteners.push(
        await listen<{ id: number; event: string; url: string }>("browser-load", (e) => {
          if (e.payload.id !== id) return;
          if (e.payload.event !== "started") {
            hist.current.busy = false;
            return setLoading(false);
          }
          const { url } = e.payload;
          const h = started(hist.current, pending.current, url);
          pending.current = null;
          hist.current = h;
          setCan(canGo(h));
          setLoading(true);
          setAddress(url === BLANK ? "" : url);
        }),
      );
      if (!alive) return;
      try {
        const first = url ? resolveAddress(url) : null;
        await invoke("browser_open", { id, url: first && "url" in first ? first.url : BLANK, spot: spot(host.current!), background: backgroundBehind(host.current) });
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
    const send = (theme = false) => {
      const shown = !hidden && el.clientWidth > 0 && el.clientHeight > 0;
      const background = theme ? backgroundBehind(el) : undefined;
      invoke("browser_bounds", { id, spot: shown ? spot(el) : { x: 0, y: 0, w: 0, h: 0 }, shown, background }).catch(() => {});
    };
    send();
    const resized = () => send();
    const observer = new ResizeObserver(resized);
    observer.observe(el);
    window.addEventListener("resize", resized);
    // BROW-011: a theme change rewrites the root's style or mode; the page's loading surface takes
    // the new pane colour at once, so the next load in a light theme is light.
    let painted = JSON.stringify(backgroundBehind(el));
    const themed = new MutationObserver(() => {
      const now = JSON.stringify(backgroundBehind(el));
      if (now === painted) return;
      painted = now;
      send(true);
    });
    themed.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-mode"] });
    return () => {
      observer.disconnect();
      themed.disconnect();
      window.removeEventListener("resize", resized);
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
        {/* BROW-006: the slot keeps the bar's place in the toolbar; in a narrow pane the bar inside it
            is compact and, while focused, floats across the toolbar (browser.css). */}
        <span className="address-slot">
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
        </span>
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
