// The 36 px top bar (DESIGN.md section 4): app mark, overflow, sidebar toggle, back/forward on
// the left; the centred Agents / Board / Terminals switcher; panel toggle, search hint, bell,
// usage pill and the window's own minimize / maximize / close on the right. The bar is the
// window's drag region (the window has no OS title bar). The search box shows the palette chord
// from the keymap (T-005), so an edit to ~/.kolux/keybindings.json changes the chips.
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowLeft, ArrowRight, Bell, Close, Dots, Mark, Maximize, Minimize, PanelLeft, PanelRight, Restore, Search } from "./icons";
import { Kbd } from "../keys/KeymapContext";
import CodexPill from "../usage/CodexPill";
import ClaudePill from "../usage/ClaudePill";
import { weeklyOf } from "../usage/claude";
import { usePlan } from "../usage/plan";

/** The three switcher screens, and the Inbox behind the bell (STAT-050: its own top-level view). */
export type Screen = "agents" | "board" | "terminals" | "inbox";
export const screens: Array<{ id: Screen; label: string }> = [
  { id: "agents", label: "Agents" },
  { id: "board", label: "Board" },
  { id: "terminals", label: "Terminals" },
];

type Props = { screen: Screen; onScreen: (s: Screen) => void; sidebarOpen: boolean; onToggleSidebar: () => void; rightOpen: boolean; onToggleRight: () => void; installed?: string[] };

export default function TopBar({ screen, onScreen, sidebarOpen, onToggleSidebar, rightOpen, onToggleRight, installed = [] }: Props) {
  const [maximized, setMaximized] = useState(false);
  // USAGE-008 / VIEW-008: a pill per provider, only with a weekly figure (or Codex's refused
  // sign-in) and an installed CLI; with neither, nothing is drawn. It is read-only: Settings
  // opens with Ctrl+, (app.settings).
  const plan = usePlan();
  const claudeOn = installed.includes("claude");
  const codexOn = installed.includes("codex");
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
        <button className="ib mark" title="Kolux RS" disabled>
          <Mark />
        </button>
        <button className="ib dots" title="Menu (not built yet)">
          <Dots />
        </button>
        <button className="ib panel" title={sidebarOpen ? "Hide sidebar" : "Show sidebar"} aria-pressed={sidebarOpen} onClick={onToggleSidebar}>
          <PanelLeft />
        </button>
        <button className="ib back" title="Back" disabled>
          <ArrowLeft size={12} />
        </button>
        <button className="ib fwd" title="Forward" disabled>
          <ArrowRight size={12} />
        </button>
      </div>

      <nav className="switcher" aria-label="Screen">
        {screens.map((s) => (
          <button key={s.id} aria-pressed={screen === s.id} onClick={() => onScreen(s.id)}>
            {s.label}
          </button>
        ))}
      </nav>

      <div className="topbar-right">
        <button className="ib panel" title={rightOpen ? "Hide Source Control" : "Show Source Control"} aria-pressed={rightOpen} onClick={onToggleRight}>
          <PanelRight />
        </button>
        <button className="searchbox" title="Search (not built yet)">
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
