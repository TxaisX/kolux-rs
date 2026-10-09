// A browser tab (BROW-001, BROW-002). The page itself is a child web view the back end lays
// over this pane's body; this component only reports where the body is and whether it is on
// screen, so the page lives on untouched while its tab, workspace or screen is away. The header
// holds the address bar, which takes the cursor with its text selected as the tab opens.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Close, Globe } from "../chrome/icons";

/** BROW-001: an empty tab shows the blank page. */
export const BLANK = "about:blank";

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

  useEffect(() => {
    let alive = true;
    const unlisteners: UnlistenFn[] = [];
    (async () => {
      unlisteners.push(
        await listen<{ id: number; event: string; url: string }>("browser-load", (e) => {
          if (e.payload.id === id && e.payload.event === "started") setAddress(e.payload.url === BLANK ? "" : e.payload.url);
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

  const go = () => {
    setNote(null);
    invoke("browser_navigate", { id, url: address }).catch((err) => setNote(String(err)));
  };

  return (
    <section className={`pane browser${focused ? " focused" : ""}`} hidden={hidden} aria-label={`${title ?? "New Tab"} pane`} onMouseDown={onFocus} data-kind="browser">
      <header className="pane-head">
        <span className="agent-mark" title="Browser">
          <Globe size={13} />
        </span>
        <span className="title">{title ?? "New Tab"}</span>
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
