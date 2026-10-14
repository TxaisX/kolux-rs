// The 36 px top bar (DESIGN.md section 4): app mark, overflow, sidebar toggle, back/forward on
// the left; the centred Agents / Board / Terminals switcher; panel toggle, search hint, bell,
// usage pill and the window's own minimize / maximize / close on the right. The bar is the
// window's drag region (the window has no OS title bar). The search box shows the palette chord
// from the keymap (T-005), so an edit to ~/.kolux/keybindings.json changes the chips.
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowLeft, ArrowRight, Bell, Clock, Close, Dots, Mark, Maximize, Minimize, PanelLeft, PanelRight, Restore, Search } from "./icons";
import { Kbd } from "../keys/KeymapContext";
import CodexPill from "../usage/CodexPill";
import ClaudePill from "../usage/ClaudePill";
import { weeklyOf } from "../usage/claude";
import { usePlan } from "../usage/plan";
import { popAppMenu } from "./useChrome";

/** Artifacts is reached from the sidebar only, so it is not in the top bar's cycle. */
/** The three switcher screens, and the Inbox behind the bell (STAT-050: its own top-level view). */
export type Screen = "agents" | "board" | "terminals" | "artifacts" | "inbox" | "tower";
export const screens: Array<{ id: Screen; label: string }> = [
  { id: "agents", label: "Agents" },
  { id: "board", label: "Board" },
  { id: "terminals", label: "Terminals" },
  { id: "tower", label: "Tower" },
];

/** `classic` (SET-037): the Classic look has no screen switcher; the window stays on Terminals. */
/** `automations` (VIEW-011): the Automations page button, present only when it is turned on in Settings > Appearance. */
export type TopBarProps = { screen: Screen; classic?: boolean; onScreen: (s: Screen) => void; sidebarOpen: boolean; onToggleSidebar: () => void; rightOpen: boolean; onToggleRight: () => void; appName?: boolean; automations?: { open: boolean; onToggle: () => void }; installed?: string[]; onSearch?: () => void; onBack?: () => void; onForward?: () => void; onZoom?: (how: "in" | "out" | "reset") => void; fullPage?: boolean; codexAccount?: boolean; appMenu?: boolean };

/** TERM-078: the overflow menu's View section; each item names its keybinding id. */
export const VIEW_ITEMS = [
  { id: "zoom.in", how: "in", label: "Zoom In" },
  { id: "zoom.out", how: "out", label: "Zoom Out" },
  { id: "zoom.reset", how: "reset", label: "Reset Size" },
] as const;

/** `appName` (SET-020): the app name beside the mark, off by default (DT-A6). */
export default function TopBar({ screen, classic = false, onScreen, sidebarOpen, onToggleSidebar, rightOpen, onToggleRight, appName = false, automations, installed = [], onSearch, onBack, onForward, onZoom, fullPage = false, codexAccount = false, appMenu = false }: TopBarProps) {
  const [maximized, setMaximized] = useState(false);
  const [menuAt, setMenuAt] = useState<{ top: number; left: number } | null>(null);
  // USAGE-008 / VIEW-008: a pill per provider, only with a weekly figure (or Codex's refused
  // sign-in) and an installed CLI; with neither, nothing is drawn. It is read-only: Settings
  // opens with Ctrl+, (app.settings).
  const plan = usePlan();
  const claudeOn = installed.includes("claude");
  // T-543-b: the Codex pill needs a Codex account, not only the CLI installed.
  const codexOn = installed.includes("codex") && codexAccount;
  const anyPill = (claudeOn && !!weeklyOf(plan.claude)) || (codexOn && !!(plan.codex?.weekly || plan.codex?.state === "sign-in-again"));
  useEffect(() => {
    const win = getCurrentWindow();
    let stop = () => {};
    win.isMaximized().then(setMaximized).catch(() => {});
    win
      .onResized(() => {
        win.isMaximized().then(setMaximized).catch(() => {});
      })
      .then((un) => (stop = un))
      .catch(() => {});
    return () => stop();
  }, []);
  const win = () => getCurrentWindow();

  return (
    <header className="topbar" data-tauri-drag-region>
      <div className="topbar-left">
        {/* APP-009 / T-248-a: the Kolux mark opens the app menu (File, Edit, View, Window, Help). */}
        <button
          className="ib mark"
          title={appMenu ? "Kolux menu" : "Kolux RS"}
          aria-haspopup={appMenu ? "menu" : undefined}
          disabled={!appMenu}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            popAppMenu(r.left, r.bottom + 4);
          }}
        >
          <Mark />
        </button>
        {appName && (
          <span className="app-name" data-tauri-drag-region>
            Kolux
          </span>
        )}
        <button
          className="ib dots"
          title="Menu"
          aria-haspopup="menu"
          aria-expanded={menuAt !== null}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenuAt({ top: r.bottom + 4, left: r.left });
          }}
        >
          <Dots />
        </button>
        {menuAt && (
          <>
            <div className="menu-backdrop" onClick={() => setMenuAt(null)} aria-hidden="true" />
            <div className="menu" role="menu" aria-label="View" style={menuAt} onKeyDown={(e) => e.key === "Escape" && setMenuAt(null)}>
              <div className="menu-title">View</div>
              {VIEW_ITEMS.map((i, n) => (
                <button key={i.id} role="menuitem" className="menu-item" autoFocus={n === 0} disabled={!onZoom} title={`${i.label} the focused terminal`} onClick={() => (setMenuAt(null), onZoom?.(i.how))}>
                  <span className="name">{i.label}</span>
                  <Kbd id={i.id} />
                </button>
              ))}
            </div>
          </>
        )}
        <button className="ib panel" title={sidebarOpen ? "Hide sidebar" : "Show sidebar"} aria-pressed={sidebarOpen} onClick={onToggleSidebar}>
          <PanelLeft />
        </button>
        <button className="ib back" title="Back to the last workspace or page shown" disabled={!onBack} onClick={onBack}>
          <ArrowLeft size={12} />
        </button>
        <button className="ib fwd" title="Forward" disabled={!onForward} onClick={onForward}>
          <ArrowRight size={12} />
        </button>
      </div>

      {!classic && (
        <nav className="switcher" aria-label="Screen">
          {screens.map((s) => (
            <button key={s.id} aria-pressed={screen === s.id} onClick={() => onScreen(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>
      )}

      <div className="topbar-right">
        {automations && (
          <button className="ib" title="Automations" aria-pressed={automations.open} onClick={automations.onToggle}>
            <Clock />
          </button>
        )}
        {/* VIEW-009: while a full page shows, the right sidebar and its control are hidden. */}
        <button className="ib panel" hidden={fullPage} title={rightOpen ? "Hide the right panel" : "Show Source Control"} aria-pressed={rightOpen} onClick={onToggleRight}>
          <PanelRight />
        </button>
        <button className="searchbox" title="Jump to a worktree, tab, project or setting" onClick={onSearch}>
          <Search />
          <span className="ph">Search</span>
          <Kbd id="worktree.palette" />
        </button>
        <button className="ib bell" aria-label="Notifications" title="Inbox" aria-pressed={screen === "inbox"} onClick={() => onScreen(screen === "inbox" ? "terminals" : "inbox")}>
          <Bell />
        </button>
        <span className="usage" hidden={!anyPill}>
          <ClaudePill installed={claudeOn} />
          <CodexPill installed={codexOn} />
        </span>
        <div className="wc">
          <button title="Minimize" onClick={() => win().minimize()}>
            <Minimize size={16} />
          </button>
          <button title={maximized ? "Restore" : "Maximize"} onClick={() => win().toggleMaximize()}>
            {maximized ? <Restore size={16} /> : <Maximize size={16} />}
          </button>
          <button className="close" title="Close" onClick={() => win().close()}>
            <Close size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
