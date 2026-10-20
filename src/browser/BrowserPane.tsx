// A browser tab (BROW-001, BROW-002, BROW-003, BROW-005, BROW-007, BROW-012, BROW-014, BROW-023). The page itself is a child web view the back end lays
// over this pane's body; this component only reports where the body is and whether it is on
// screen, so the page lives on untouched while its tab, workspace or screen is away. The header
// holds the address bar, which takes the cursor with its text selected as the tab opens, and
// the back / forward / reload toolbar; what the bar makes of typed text is in address.ts.
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ArrowLeft, ArrowRight, Close, Globe, Refresh, Stop, Target } from "../chrome/icons";
import { BLANK, resolveAddress } from "./address";
import { chordPlan, openerRefocus, windowHasFocus } from "./chord";
import { type KeyEvent, keyEventInit, pageKeys } from "./keys";
import { type MenuEvent, menuAt, menuColours, menuContext, menuSpec } from "./menu";
import { dropPage, livePage } from "./pages";
import { useKeymap } from "../keys/KeymapContext";
import { backgroundBehind } from "./colour";
import "./browser.css";
import { can as canGo, fresh, started, type Pending } from "./history";
import { arrived, closed as menuClosed, fresh as freshMenu, type Hit, lines as suggestionLines, type Menu, move as menuMove, pick as menuPick, shown as menuShown, typed as menuTyped } from "./suggest";
import { busy as downloading, dismiss, type Download, fraction, prune, reduce as reduceDownloads, type Row as DownloadRow, status as downloadStatus } from "./downloads";
import { type Diagnosis, type Event as LoadEvent, fresh as freshHealth, type Health, type Overlay, overlayModel, overlayOf, PROBE_MS, type Probe, step } from "./loadState";
import { nextZoom, zoomPercent } from "./zoom";
import { iconAt, iconFound, type SiteIcon } from "./site";
import { zoomFactor } from "../settings/zoom";
import { notePage } from "../onboarding/guide";
import { addNote, MAX_NOTES, type Note, notesMarkdown, type Pick, readPicks, sameAddress } from "./annotate";
import type { SendTarget } from "../editor/notes";

/** `url`: the page or file the tab opens on instead of a blank page (SKILL-012 previews a kit result). */
/** `cwd`: the worktree this tab belongs to (BROW-042: agents there drive it); `targets` / `onSend`: the agent panes
 * a page note can go to and how it is pasted (BROW-037; App.tsx passes the review-notes send path). */
type Props = { id: number; url?: string; title?: string; hidden?: boolean; focused?: boolean; onFocus?: () => void; onClose?: () => void; cwd?: string | null; targets?: () => SendTarget[]; onSend?: (key: number, text: string) => Promise<void> | void };

/** The pane body's place in the window, in CSS pixels, as the back end places the page. */
/** GIT-036: asks the window for a new browser tab at `url` in the focused split. */
export const OPEN_IN_BROWSER = "kolux-open-in-browser";
export const openInBrowser = (url: string, title?: string) => window.dispatchEvent(new CustomEvent<OpenInBrowser>(OPEN_IN_BROWSER, { detail: title === undefined ? url : { url, title } }));
/** The event's detail: the address alone, or with a fixed tab name (T-242: "Preview host:port"). */
export type OpenInBrowser = string | { url: string; title: string };
export const openDetail = (d: OpenInBrowser): { url: string; title?: string } => (typeof d === "string" ? { url: d } : d);

/** T-241 (BROW-039): what a tab's address previews, when it is a worktree document of ours. */
type Preview = { folder: string; file: string; path: string };

/** T-241 (BROW-044): `kolux tab create` asks the window for a tab; one listener for the whole
 * window, started by the first pane, so a tab opens once however many panes there are. */
let bridge = false;
function startBridge() {
  if (bridge) return;
  bridge = true;
  listen<{ action: string; url?: string }>("browser-cli", (e) => {
    if (e.payload.action === "create") openInBrowser(e.payload.url ?? BLANK);
  }).catch(() => {
    bridge = false;
  });
}

type OverlayProps = { overlay: NonNullable<Overlay>; diag: Diagnosis | null; busy: boolean; connecting: boolean; onRetry: () => void; onHttps: (url: string) => void; onOpen: (url: string) => void };

/** T-074 (BROW-008, BROW-009): what the user sees over a page that failed or crashed. */
function LoadOverlay({ overlay, diag, busy, connecting, onRetry, onHttps, onOpen }: OverlayProps) {
  const m = overlayModel(overlay, diag);
  return (
    <div className="load-overlay" role="alert" data-kind={overlay.kind}>
      <h2>{m.title}</h2>
      <p>{m.text}</p>
      {m.advice && <p className="advice">{m.advice}</p>}
      <div className="btn-row">
        <button className="btn" data-go="retry" disabled={busy} onClick={onRetry}>
          Retry
        </button>
        {m.switchHttps && (
          <button className="btn" data-go="https" disabled={busy} onClick={() => onHttps(m.switchHttps!)}>
            Switch to HTTPS
          </button>
        )}
        {m.openExternally && (
          <button className="btn" data-go="external" disabled={busy} onClick={() => onOpen(overlay.url)}>
            Open Externally
          </button>
        )}
      </div>
      {connecting && (
        <p className="connecting" role="status">
          Connecting…
        </p>
      )}
    </div>
  );
}

function spot(el: HTMLElement) {
  // SET-019: the window places the page in unzoomed pixels, so a zoomed rect is scaled back.
  const r = el.getBoundingClientRect();
  const z = zoomFactor();
  return { x: r.left * z, y: r.top * z, w: r.width * z, h: r.height * z };
}

export default function BrowserPane({ id, url, title, hidden = false, focused = false, onFocus, onClose, cwd = null, targets, onSend }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const opened = useRef(false);
  const [address, setAddress] = useState("");
  // T-238-b (BROW-004): the drop-down under the bar; `typing` while the bar holds the user's own
  // text, so a page replacing the one underneath does not overwrite it. (BROW-013): the strip of
  // this tab's downloads.
  const [menu, setMenu] = useState<Menu>(freshMenu());
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const typing = useRef(false);
  const suggestTimer = useRef<number | undefined>(undefined);
  const [downloads, setDownloads] = useState<DownloadRow[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [can, setCan] = useState({ back: false, forward: false });
  const canRef = useRef(can);
  canRef.current = can;
  const keymap = useKeymap();
  // ponytail: wry has no can-go-back, so history is tracked from this tab's own actions and the
  // page loads it sees (history.ts). The chords pressed inside the page come back through the
  // app (T-012-b-fix), so the web view never goes back on its own; a page's pushState still
  // drifts it. Upgrade when wry exposes navigation history.
  const hist = useRef(fresh());
  const pending = useRef<Pending>(null);
  // BROW-012: this tab's own zoom; the badge shows the level for a moment after each change.
  const zoom = useRef(1);
  const [badge, setBadge] = useState<string | null>(null);
  const badgeTimer = useRef<number | undefined>(undefined);
  // BROW-007: the find bar; `null` while closed.
  const [find, setFind] = useState<string | null>(null);
  // BROW-023: the site icon in the toolbar; the globe until the site gives one.
  const [icon, setIcon] = useState<SiteIcon>(null);
  const at = useRef("");
  const findBox = useRef<HTMLInputElement>(null);
  // BROW-037: notes on the page's elements. `picking` while the page picker runs; `draft` is a pick
  // waiting for its note; the tray empties when the page's address changes (annotate.ts).
  const [picking, setPicking] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState<Pick | null>(null);
  const [sendMenu, setSendMenu] = useState<SendTarget[] | null>(null);
  const draftBox = useRef<HTMLTextAreaElement>(null);
  const focusMe = useRef(onFocus);
  focusMe.current = onFocus;
  const closeMe = useRef(onClose);
  closeMe.current = onClose;
  const [preview, setPreview] = useState<Preview | null>(null);
  // T-074 (BROW-008, BROW-009): the page's health. The engine says only started / finished, so the
  // pane probes the page (browser_probe) and feeds loadState's machine; the overlay it decides on
  // covers the pane body while the page itself is hidden under it (a child web view cannot be
  // covered by the app's own elements). `diag` is the back end's look at why the address failed.
  const health = useRef<Health>(freshHealth());
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [diag, setDiag] = useState<Diagnosis | null>(null);
  // While an overlay action runs all its buttons are disabled together; the connecting indicator
  // waits a moment so a quick retry does not flicker.
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const feed = (e: LoadEvent) => {
    const [h, action] = step(health.current, e);
    health.current = h;
    setOverlay(overlayOf(h));
    if (e.t === "started") {
      setBusy(false);
      setDiag(null);
    }
    if (action === "reload") invoke("browser_go", { id, what: "reload" }).catch(() => {});
    if (action === "overlay") {
      setBusy(false);
      if (h.phase === "failed") {
        const { url } = h;
        invoke<Diagnosis>("browser_diagnose", { url })
          .then((d) => health.current.url === url && setDiag(d))
          .catch(() => {});
      }
    }
  };
  const retry = () => {
    setBusy(true);
    feed({ t: "retry" });
  };
  useEffect(() => {
    if (!busy) return setConnecting(false);
    const t = window.setTimeout(() => setConnecting(true), 300);
    return () => window.clearTimeout(t);
  }, [busy]);

  useEffect(() => {
    let alive = true;
    const unlisteners: UnlistenFn[] = [];
    (async () => {
      unlisteners.push(
        await listen<{ id: number; event: string; url: string }>("browser-load", (e) => {
          if (e.payload.id !== id) return;
          feed(e.payload.event === "started" ? { t: "started", url: e.payload.url } : { t: "finished", url: e.payload.url });
          if (e.payload.event !== "started") {
            hist.current.busy = false;
            // BROW-012: the level holds through reloads and other sites; set it again in case the
            // engine reset it with the new document.
            if (zoom.current !== 1) invoke("browser_go", { id, what: "zoom", level: zoom.current }).catch(() => {});
            if (e.payload.event === "finished") notePage(e.payload.url); // ONB-015
            return setLoading(false);
          }
          const { url } = e.payload;
          const h = started(hist.current, pending.current, url);
          pending.current = null;
          hist.current = h;
          setCan(canGo(h));
          setLoading(true);
          if (!typing.current) setAddress(url === BLANK ? "" : url); // BROW-004: typed text survives
          if (!sameAddress(at.current, url)) {
            setNotes([]);
            setDraft(null);
          }
          at.current = url;
          setIcon((i) => iconAt(i, url));
          invoke<Preview | null>("browser_preview_of", { url })
            .then((p) => alive && setPreview(p ?? null))
            .catch(() => setPreview(null));
        }),
      );
      // T-238-b (BROW-013): this tab's downloads, one event per change.
      unlisteners.push(
        await listen<Download>("browser-download", (e) => {
          if (e.payload.id !== id) return;
          setDownloads((rows) => reduceDownloads(rows, e.payload, Date.now()));
        }),
      );
      // BROW-014: a link the page opens as a new window, or Mod / middle click, becomes another tab
      // in this split; behind this one unless it asked for the front.
      unlisteners.push(
        await listen<{ id: number; url: string; front: boolean }>("browser-link", (e) => {
          if (e.payload.id !== id) return;
          openInBrowser(e.payload.url);
          // Council FIX-4: not while the user is in another program (the app's window is not focused).
          const { front } = e.payload;
          const appHasFocus = document.hasFocus();
          void windowHasFocus().then((w) => openerRefocus(front, appHasFocus, w) && setTimeout(() => focusMe.current?.(), 0));
        }),
      );
      unlisteners.push(
        await listen<{ id: number; page: string; icon: string }>("browser-icon", (e) => {
          if (e.payload.id === id) setIcon((i) => iconFound(i, at.current, e.payload.page, e.payload.icon));
        }),
      );
      // T-239 (BROW-017): a right-click inside the page, and the menu entry picked afterwards.
      unlisteners.push(
        await listen<MenuEvent>("browser-menu", (e) => {
          if (e.payload.id === id) void onMenu.current(e.payload);
        }),
      );
      // T-239 (BROW-018): an app shortcut pressed while the keyboard was inside the page.
      unlisteners.push(
        await listen<KeyEvent>("browser-key", (e) => {
          if (e.payload.id === id) void onKey.current(e.payload);
        }),
      );
      // T-241 (BROW-044): `kolux tab switch|close` name this pane.
      unlisteners.push(
        await listen<{ action: string; page?: number }>("browser-cli", (e) => {
          if (e.payload.page !== id) return;
          if (e.payload.action === "switch") focusMe.current?.();
          if (e.payload.action === "close") closeMe.current?.();
        }),
      );
      startBridge();
      if (!alive) return;
      try {
        const first = url ? resolveAddress(url) : null;
        // A tab opened behind (its section hidden, so no size) starts off screen: its page may not
        // open tabs or send chords until it is shown (council FIX-2).
        const body = host.current!;
        const shown = body.clientWidth > 0 && body.clientHeight > 0;
        await invoke("browser_open", { id, url: first && "url" in first ? first.url : BLANK, spot: spot(body), background: backgroundBehind(body), shown });
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
      // T-074: while the recovery overlay shows, the page is hidden so the overlay can cover it.
      const shown = !hidden && !overlay && el.clientWidth > 0 && el.clientHeight > 0;
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
  }, [id, open, hidden, overlay]);

  // T-074: the probe, about four times a second while the page is on screen (BROW-008), paused
  // while the tab is hidden or the overlay covers the page. One probe in flight at a time.
  useEffect(() => {
    if (!open || hidden || overlay) return;
    let inflight = false;
    const t = window.setInterval(async () => {
      if (inflight) return;
      inflight = true;
      try {
        feed({ t: "probe", answer: await invoke<Probe>("browser_probe", { id }) });
      } catch {
        feed({ t: "probe", answer: "no-answer" });
      } finally {
        inflight = false;
      }
    }, PROBE_MS);
    return () => window.clearInterval(t);
  }, [id, open, hidden, overlay]);

  // BROW-042: the command line's browser commands go to the worktree's tab on screen; this pane
  // says which worktree its tab belongs to and whether it is the one shown.
  useEffect(() => {
    if (!open) return;
    invoke("browser_tab", { id, worktree: cwd, shown: !hidden, url: at.current, title: title ?? "" }).catch(() => {});
  }, [id, open, hidden, cwd, loading, title]);

  // T-239 (BROW-018): the page is told which chords are the app's, from the live keymap (so a
  // customised binding counts), again after each load since a new document starts from the script's
  // own defaults.
  useEffect(() => {
    if (!open) return;
    invoke("browser_go", { id, what: "keys", text: JSON.stringify(pageKeys(keymap)) }).catch(() => {});
  }, [id, open, loading, keymap.bindings]);

  // T-239 (BROW-019, BROW-022): the window's registry of live pages, which the jump palette lists
  // and Reopen Closed Tab reads from; this pane's row leaves with it.
  useEffect(() => {
    livePage(id, { url: at.current, title: title ?? "", icon: icon?.src ?? null, cwd });
  }, [id, loading, title, icon, cwd]);
  useEffect(() => () => dropPage(id), [id]);

  // BROW-037: while picking, the page's picker is asked four times a second what was clicked; a
  // page that was replaced meanwhile gets the picker again. Escape in the page ends picking.
  useEffect(() => {
    if (!open || !picking) return;
    let inflight = false;
    const t = window.setInterval(async () => {
      if (inflight) return;
      inflight = true;
      try {
        const r = readPicks(await invoke("browser_annotate", { id, what: "poll" }));
        if (!r.active) await invoke("browser_annotate", { id, what: "start" });
        if (r.escape) setPicking(false);
        if (r.picks.length) setDraft((d) => d ?? r.picks[0]);
      } catch {
        setPicking(false);
      } finally {
        inflight = false;
      }
    }, 250);
    return () => window.clearInterval(t);
  }, [id, open, picking]);
  useEffect(() => {
    if (draft) draftBox.current?.focus();
  }, [draft]);
  const stopPicking = () => {
    setPicking(false);
    invoke("browser_annotate", { id, what: "stop" }).catch(() => {});
  };
  const togglePicking = () => {
    if (picking) return stopPicking();
    if (notes.length >= MAX_NOTES) return setNote(`The tray holds ${MAX_NOTES} notes; send or clear them first`);
    setNote(null);
    invoke("browser_annotate", { id, what: "start" })
      .then(() => setPicking(true))
      .catch((err) => setNote(String(err)));
  };
  // Enter keeps the note (Shift+Enter is a new line); Escape drops only this pick, picking stays on.
  const keepDraft = () => {
    if (!draft) return;
    const next = addNote(notes, draft, draftBox.current?.value ?? "");
    setDraft(null);
    if (!next) return;
    setNotes(next);
    if (next.length >= MAX_NOTES && picking) {
      stopPicking();
      setNote(`The tray is full (${MAX_NOTES} notes); send or clear them to pick more`);
    }
  };
  const openSend = () => {
    const list = targets?.() ?? [];
    if (!list.length) return setNote("No agent sessions in this worktree");
    setSendMenu(list);
  };
  const sendTo = (key: number) => {
    setSendMenu(null);
    const text = notesMarkdown(notes, title ?? "", at.current);
    if (!text) return;
    Promise.resolve(onSend?.(key, text))
      .then(() => setNotes([]))
      .catch((err) => setNote(String(err)));
  };

  // T-238-b (BROW-013): finished rows leave the strip on their own after a while.
  useEffect(() => {
    if (downloads.length === 0 || downloading(downloads)) return;
    const t = window.setInterval(() => setDownloads((rows) => prune(rows, Date.now())), 1000);
    return () => window.clearInterval(t);
  }, [downloads]);

  // T-238-b (BROW-004): each keystroke asks the back end for ranked history hits; a late answer
  // for text the user has moved past is dropped by the model.
  const onTyped = (text: string) => {
    typing.current = true;
    setAddress(text);
    setMenu((m) => menuTyped(m, text));
    window.clearTimeout(suggestTimer.current);
    if (!text.trim()) return;
    suggestTimer.current = window.setTimeout(() => {
      invoke<Hit[]>("browser_suggest", { text })
        .then((hits) => setMenu((m) => arrived(m, text, hits)))
        .catch(() => {});
    }, 60);
  };
  const closeMenu = () => setMenu((m) => (m.open ? menuClosed(m) : m));

  // BROW-003: Enter reads the bar; an invalid address is said in the notice and the page stays.
  const navigateTo = (url: string) => {
    setNote(null);
    typing.current = false;
    setMenu((m) => menuClosed(m));
    pending.current = null;
    feed({ t: "navigate" }); // a new address gets its own recovery allowance (BROW-009)
    invoke("browser_navigate", { id, url }).catch((err) => setNote(String(err)));
  };
  const go = () => {
    const picked = menuPick(menuRef.current);
    if (picked) return navigateTo(picked.url);
    const r = resolveAddress(address);
    if ("error" in r) return setNote(r.error);
    navigateTo(r.url);
  };
  const switchHttps = (url: string) => {
    setBusy(true);
    navigateTo(url);
  };
  const openExternally = (url: string) => {
    setBusy(true);
    invoke("open_external", { url })
      .catch((err) => setNote(String(err)))
      .finally(() => setBusy(false));
  };
  const zoomBy = (how: "in" | "out" | "reset") => {
    zoom.current = nextZoom(zoom.current, how);
    invoke("browser_go", { id, what: "zoom", level: zoom.current }).catch((err) => setNote(String(err)));
    setBadge(zoomPercent(zoom.current));
    window.clearTimeout(badgeTimer.current);
    badgeTimer.current = window.setTimeout(() => setBadge(null), 1200);
  };
  const openFind = () => {
    setFind((f) => f ?? "");
    setTimeout(() => {
      findBox.current?.focus();
      findBox.current?.select();
    }, 0);
  };
  const findNext = (back: boolean) => {
    const text = findBox.current?.value ?? "";
    if (text) invoke("browser_go", { id, what: back ? "findBack" : "find", text }).catch((err) => setNote(String(err)));
  };
  // BROW-005: the toolbar; a reload is the same page, so it leaves the history alone.
  const act = (what: "back" | "forward" | "reload" | "stop") => {
    // BROW-005 / BROW-008 / BROW-009: on a failed or crashed page every reload trigger is a Retry.
    if (what === "reload" && overlay) return retry();
    pending.current = what === "reload" ? "same" : what === "stop" ? null : what;
    invoke("browser_go", { id, what }).catch((err) => setNote(String(err)));
  };

  // T-239 (BROW-017): the right-click menu. The page says where the click was and what was under
  // it; menu.ts decides the entries and the corner (flipped near the pane's edges); the page draws
  // it and says which entry was picked. Both go through chordPlan, so a page script that fakes one
  // while the keyboard is in the app is ignored (council FIX-3/4).
  const onMenu = useRef(async (_p: MenuEvent) => {});
  onMenu.current = async (p) => {
    const plan = await chordPlan(id, p.kind);
    if (!plan.run) return;
    if (plan.focusPane) focusMe.current?.();
    if (p.kind === "menu") {
      const spec = menuSpec(menuContext(p), canRef.current, at.current, menuAt(p), menuColours(host.current));
      void invoke("browser_go", { id, what: "menu", text: JSON.stringify(spec) }).catch(() => {});
      return;
    }
    const u = /^https?:/i.test(p.u ?? "") ? p.u! : "";
    if (p.what === "back" || p.what === "forward") act(p.what);
    else if (p.what === "open-kolux" && u) openInBrowser(u);
    else if (p.what === "open-default" && u) invoke("open_external", { url: u }).catch((err) => setNote(String(err)));
  };
  // T-239 (BROW-018): an app shortcut the page handed over is pressed again on the window, after
  // this split has taken focus (flushSync, so the app's key handler already sees it focused), and
  // the app's own key handling runs it, customised bindings included.
  const onKey = useRef(async (_p: KeyEvent) => {});
  onKey.current = async (p) => {
    const plan = await chordPlan(id, "key");
    if (!plan.run) return;
    if (plan.focusPane) flushSync(() => focusMe.current?.());
    window.dispatchEvent(new KeyboardEvent("keydown", keyEventInit(p)));
  };

  return (
    <section className={`pane browser${focused ? " focused" : ""}`} hidden={hidden} aria-label={`${title ?? "New Tab"} pane`} onMouseDown={onFocus} data-kind="browser" data-key={id}>
      <header className="pane-head">
        <span className="agent-mark" title="Browser">
          {icon ? <img className="site-icon" src={icon.src} width={13} height={13} alt="" /> : <Globe size={13} />}
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
          {preview ? (
            // BROW-039: a previewed document shows where it is instead of its loopback address.
            <span className="preview-chip" title={preview.path}>
              <span className="preview-folder">{preview.folder}</span>
              <span className="preview-sep">/</span>
              <b>{preview.file}</b>
              <button type="button" className="ib preview-copy" title="Copy the file's path" aria-label="Copy path" onClick={() => void navigator.clipboard?.writeText(preview.path).catch(() => {})}>
                copy
              </button>
            </span>
          ) : null}
          <input
            ref={bar}
            className="address"
            style={preview ? { display: "none" } : undefined}
            aria-label="Address"
            placeholder="Address"
            value={menuShown(menu, address)}
            autoFocus
            role="combobox"
            aria-expanded={menu.open && menu.items.length > 0}
            aria-controls={`suggest-${id}`}
            aria-autocomplete="list"
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => {
              // BROW-004: leaving the bar (a click into the page takes the keyboard too) closes the
              // list and keeps the typed text; once the bar is left, the next load may show its address.
              closeMenu();
              typing.current = false;
            }}
            onChange={(e) => onTyped(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") go();
              else if (e.key === "Escape") {
                e.preventDefault();
                closeMenu();
              } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                if (!menu.open) return;
                e.preventDefault();
                setMenu((m) => menuMove(m, e.key === "ArrowDown" ? 1 : -1));
              }
            }}
          />
        </span>
        {badge && (
          <span className="zoom-badge" role="status" aria-label="Zoom">
            {badge}
          </span>
        )}
        {/* The app runs these for a chord pressed in the app or inside the page (App's browserAction
            clicks [data-go]): find (BROW-007) and zoom (BROW-012). */}
        <button hidden data-go="find" onClick={openFind} />
        <button hidden data-go="zoomIn" onClick={() => zoomBy("in")} />
        <button hidden data-go="zoomOut" onClick={() => zoomBy("out")} />
        <button hidden data-go="zoomReset" onClick={() => zoomBy("reset")} />
        <span className="right">
          {/* BROW-037: pick elements in the page and write notes on them for an agent. */}
          <button className={`ib${picking ? " on" : ""}`} data-go="annotate" onClick={togglePicking} title={picking ? "Stop picking elements" : "Annotate: pick elements and write notes for an agent"} aria-label="Annotate" aria-pressed={picking}>
            <Target size={12} />
          </button>
          <button className="ib" onClick={onClose} title="Close tab (Ctrl+W)">
            <Close size={12} />
          </button>
        </span>
      </header>
      {/* BROW-004: the drop-down sits in the pane's flow (a child web view cannot be covered), so
          the page below moves down while it is open. Mouse-down, not click, so the bar keeps focus. */}
      {menu.open && menu.items.length > 0 && (
        <ul className="suggest" id={`suggest-${id}`} role="listbox" aria-label="Suggestions">
          {menu.items.map((s, i) => {
            const [head, sub] = suggestionLines(s);
            return (
              <li
                key={`${s.kind}:${s.url}`}
                role="option"
                aria-selected={i === menu.cursor}
                className={`${s.kind}${i === menu.cursor ? " on" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  navigateTo(s.url);
                }}
              >
                <span className="head">{head}</span>
                {sub && <span className="sub">{sub}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {/* BROW-013: the tab's downloads, with bytes received and the total when known. */}
      {downloads.length > 0 && (
        <ul className="downloads" role="status" aria-label="Downloads">
          {downloads.map((d) => {
            const f = fraction(d);
            return (
              <li key={d.key} className={d.state} title={d.path}>
                <span className="name">{d.name}</span>
                <span className="state">{downloadStatus(d)}</span>
                {d.state === "running" && <progress max={1} value={f ?? undefined} aria-label="Download progress" />}
                {d.state !== "running" && (
                  <button className="ib" onClick={() => setDownloads((rows) => dismiss(rows, d.key))} title="Dismiss" aria-label="Dismiss">
                    <Close size={10} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {find !== null && (
        <div className="find-bar" role="search">
          <input
            ref={findBox}
            className="find"
            aria-label="Find in page"
            placeholder="Find in page"
            value={find}
            onChange={(e) => setFind(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") findNext(e.shiftKey);
              else if (e.key === "Escape") setFind(null);
            }}
          />
          <button className="ib" onClick={() => findNext(true)} title="Previous match (Shift+Enter)" aria-label="Previous match">
            <ArrowLeft size={12} />
          </button>
          <button className="ib" onClick={() => findNext(false)} title="Next match (Enter)" aria-label="Next match">
            <ArrowRight size={12} />
          </button>
          <button className="ib" onClick={() => setFind(null)} title="Close find (Escape)" aria-label="Close find">
            <Close size={12} />
          </button>
        </div>
      )}
      {(picking || draft || notes.length > 0) && (
        <div className="notes-tray" role="region" aria-label="Page notes">
          <div className="tray-head">
            <span className="hint">{picking ? "Click an element in the page" : "Notes for an agent"}</span>
            {notes.length > 0 && <span className="count">{notes.length}/{MAX_NOTES}</span>}
            {notes.length > 0 && (
              <button className="btn" data-go="send-notes" onClick={openSend}>
                Send to agent…
              </button>
            )}
            {notes.length > 0 && (
              <button className="btn" onClick={() => setNotes([])}>
                Clear
              </button>
            )}
          </div>
          {draft && (
            <div className="draft">
              <code title={draft.path}>{draft.selector}</code>
              <textarea
                ref={draftBox}
                aria-label="Note on this element"
                placeholder="What about this element? Enter keeps it, Escape drops it"
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    keepDraft();
                  } else if (e.key === "Escape") setDraft(null);
                }}
              />
              <button className="btn" onClick={keepDraft}>
                Add
              </button>
            </div>
          )}
          {notes.length > 0 && (
            <ol className="notes">
              {notes.map((n, i) => (
                <li key={i}>
                  <code title={n.pick.path}>{n.pick.selector}</code> {n.text}
                  <button className="ib" aria-label="Remove note" title="Remove note" onClick={() => setNotes(notes.filter((_, j) => j !== i))}>
                    <Close size={10} />
                  </button>
                </li>
              ))}
            </ol>
          )}
          {sendMenu && (
            <ul className="send-menu" role="menu" aria-label="Send notes to">
              {sendMenu.map((t) => (
                <li key={t.key}>
                  <button role="menuitem" onClick={() => sendTo(t.key)}>
                    {t.label} <small>{t.since}</small>
                  </button>
                </li>
              ))}
              <li>
                <button role="menuitem" onClick={() => setSendMenu(null)}>
                  Cancel
                </button>
              </li>
            </ul>
          )}
        </div>
      )}
      {note && (
        <div className="notice" role="alert">
          {note}
        </div>
      )}
      <div ref={host} className="pane-body">
        {overlay && <LoadOverlay overlay={overlay} diag={diag} busy={busy} connecting={connecting} onRetry={retry} onHttps={switchHttps} onOpen={openExternally} />}
      </div>
    </section>
  );
}
