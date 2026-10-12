// The window: top bar, then the sidebar card beside the content column (layout strip over the
// pane grid), then the status bar. Agents is an empty screen for now; Board lists every pane as
// a card and a card can show its live terminal without moving it (T-011); Terminals holds
// the pane list and the sidebar. The list starts with one PowerShell pane (T-002); the plus
// menu adds an agent pane in a fresh creature-named workspace (T-004). The grid shows one
// workspace at a time; the other workspaces' panes stay mounted but hidden, so switching back
// finds every terminal as it was (T-006). The grid tiles 1..12 cells in balanced rows; the
// layout strip sets the count, a pane splits right or down and closes (T-009, src/terminal/grid.ts).
// A cell holds tabs: Ctrl+T or the strip's "New tab" menu adds a shell or an agent beside the
// focused pane, started in the workspace folder (T-010). A browser tab is a pane whose page is
// a child web view laid over its body by the back end (T-012-a, src/browser/BrowserPane.tsx);
// its shortcuts (bar, back, forward, reload) apply while a browser pane is focused (T-012-b).
// Source Control is a card on the right (Mod+Shift+G, Mod+L or the top bar's panel button): the
// workspace in front's changes, staging and a commit box; its draft message is kept here per
// worktree (T-018-a, src/scm/SourceControlPanel.tsx).
// An editor tab is one file in CodeMirror (T-093-a, src/editor/EditorPane.tsx): "File..." in the
// New tab menu opens one, and Mod+S saves the focused editor while the terminals screen is up.
// Markdown (T-093-b): Mod+Shift+V opens a read-only preview tab, Mod+Shift+O picks one of the
// worktree's markdown files, Mod+Shift+M makes a new untitled note at the worktree root.
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { windowTitle, type AppInfo } from "./app-info";
import TopBar, { screens, type Screen } from "./chrome/TopBar";
import SettingsPage from "./settings/SettingsPage";
import CloseAsk from "./terminal/CloseAsk";
import { asksBeforeClose, busyCount, closeQuestion } from "./terminal/closing";
import { applyAppearance, readAppearance } from "./theme";
import SignInNotice from "./settings/SignInNotice";
import { readLook, startScreen } from "./settings/general";
import { OPEN_SETTINGS, openSettings, PAGES, type PageId, type SettingsTarget } from "./settings/pages";
import WorktreePalette, { type PaletteItem } from "./projects/WorktreePalette";
import { EMPTY_HISTORY, navTarget, travel, visit, type Place } from "./projects/nav";
import LayoutStrip, { type NewTab, type ShellInfo } from "./chrome/LayoutStrip";
import BrowserPane from "./browser/BrowserPane";
import EditorPane, { editors } from "./editor/EditorPane";
import { baseName, keyOf } from "./editor/buffers";
import PreviewPane from "./editor/PreviewPane";
import FilePicker, { quickOpenList, type Pick } from "./editor/FilePicker";
import ArtifactsPage from "./artifacts/ArtifactsPage";
import { KitGallery, KitSetup, OPEN_KITS } from "./kits/Kits";
import { KITS, VENDORS, RECALL_KEY, remember, type Kit, type Vendor } from "./kits/catalog";
import KitStrip, { useKitCheck } from "./kits/KitStrip";
import { datedName, matchSeats, roleDone, rolePrompt, seatTitle, type RunCheck } from "./kits/run";
import DiffPane, { diffNav } from "./editor/DiffPane";
import AllChangesPane from "./editor/AllChangesPane";
import Explorer from "./editor/Explorer";
import { isMarkdown } from "./editor/markdown";
import { open } from "@tauri-apps/plugin-dialog";
import { cellsOf, clampCount, columnsFor, groupOf, insertBefore, MAX_PANES, neighbourTab, resizePlan, rowsFor, splitIndex, toggleCard } from "./terminal/grid";
import StatusBar from "./chrome/StatusBar";
import { FileCode } from "./chrome/icons";
import UpdateCenter from "./update/UpdateCenter";
import VendorMark, { type Agent } from "./chrome/VendorMark";
import TerminalPane from "./terminal/TerminalPane";
import ProjectsPanel, { type Page } from "./projects/ProjectsPanel";
import AutomationsPage from "./automations/AutomationsPage";
import RoutingPage from "./settings/RoutingPage";
import SourceControlPanel from "./scm/SourceControlPanel";
import { SUMMARY_UPSTREAM_KEY } from "./scm/model";
import { markFor, programWord, type AgentInfo } from "./launch/PlusMenu";
import { allSwitchedOff, DEFAULT_AGENT_KEY, defaultAgentId, FIRST_PASS, menuAgents, offeredAgents, type AgentPass } from "./launch/agents";
import { paneState, strongest, type AgentState, type RowInfo } from "./projects/rows";
import { nextNeedsYou } from "./terminal/status";
import { marksUnread, tabBadge, type Badge } from "./terminal/tabs";
import { Bell, CheckCircle, Help, Spinner } from "./chrome/icons";
import ChooserPane from "./launch/ChooserPane";
import { applyLineup, clearMissing, LAST_LINEUP_KEY, lineupOf, offeredLineup, removeTarget, defaultCopies, emptySeat, seatArgs, openingPrompt, type Lineup, rulesBlock, TERMINAL, withoutFailed, type Copies, type Seat, type Shape } from "./launch/seats";
import { folderName, NESTING_KEY, type CliWorkspace, type Project, type Worktree } from "./projects/model";
import { activeAfterRemove, focusIn, panesIn, sameDir, withoutDir } from "./workspaces";
import { KeymapProvider, useKeymap } from "./keys/KeymapContext";
import { matchEvent } from "./keys/keymap";

export type ShellTarget = { dir: string | null; branch: string | null };

/** A pane with `seats` is a chooser (SESS-007): nothing runs in it until Start. */
/** SKILL-008: a seat waiting for the role it depends on. */
type KitWait = { role: string; upstream: string; key: number; prompt: string };
type KitRun = { started: number; seats: (number | null)[] | null; waiting: KitWait[]; sent: Record<string, number> };
/** Which kit AI a pane runs, from its mark or, for Grok, its program. */
const aiOf = (p: { agent: string; program: string | null }): string | null => (p.agent === "claude" || p.agent === "codex" ? p.agent : /grok/i.test(p.program ?? "") ? "grok" : null);
type Pane = { key: number; cwd: string | null; branch: string | null; agent: Agent; program: string | null; args: string[]; env?: [string, string][]; seats?: Seat[]; copies?: Copies; shape?: Shape; task?: string; title?: string; word?: string; batch?: number; typed?: string; group?: number; kind?: "browser" | "editor" | "preview" | "diff" | "changes"; path?: string; staged?: boolean };

/** What a tab is called: the seat's title, the agent, the browser page's title, or "Terminal N". */
function tabName(p: Pane, titles: Record<number, string>): string {
  if (p.kind === "browser") return titles[p.key] || "New Tab";
  if (p.kind === "editor") return baseName(p.path ?? "");
  if (p.kind === "preview") return `Preview ${baseName(p.path ?? "")}`;
  if (p.kind === "changes") return "All Changes";
  if (p.kind === "diff") return `${baseName(p.path ?? "")} (${p.staged ? "staged" : "unstaged"})`;
  return p.title || (p.agent !== "shell" ? programWord(p.agent) : `Terminal ${p.key}`);
}
/** TERM-055: the one badge a tab carries beside its agent icon. */
const badges: Record<NonNullable<Badge>, [(p: { size?: number }) => ReactElement, string]> = {
  working: [Spinner, "working"],
  permission: [Help, "needs permission"],
  unread: [Bell, "unread"],
  done: [CheckCircle, "done"],
};
function TabBadge({ kind }: { kind: Badge }) {
  if (!kind) return null;
  const [Icon, label] = badges[kind];
  return (
    <span className={`badge ${kind}`} role="img" aria-label={label}>
      <Icon size={11} />
    </span>
  );
}
/** SESS-051: a seat's start line as the back end builds it. */
type StartLine = { args: string[]; typed: string | null; program: string | null; env: [string, string][] };

/** Columns for a pane count: 1, side by side for 2, two rows for 3-4, then three across. */
/** `initial`: the settings read before the first frame (main.tsx), so the first screen is right at once. */
export default function App({ initial = {} }: { initial?: Record<string, unknown> }) {
  return (
    <KeymapProvider>
      <Window initial={initial} />
    </KeymapProvider>
  );
}

/** The next screen in the Agents / Board / Terminals cycle. */
export function nextScreen(s: Screen): Screen {
  return screens[(screens.findIndex((x) => x.id === s) + 1) % screens.length].id;
}

function Window({ initial }: { initial: Record<string, unknown> }) {
  const keymap = useKeymap();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [screen, setScreen] = useState<Screen>(() => startScreen(initial)); // SET-037
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsAt, setSettingsAt] = useState<{ target: SettingsTarget | null; n: number }>({ target: null, n: 0 }); // SET-006: a link's page and section
  const [expanded, setExpanded] = useState<number | null>(null); // VIEW-026: the Board card showing its terminal
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // DT-17: Automations is a page of its own over the content column, opened from the sidebar;
  // the grid stays mounted (hidden) behind it.
  // SET-028: Model routing opens the same way until Settings > Agents exists.
  const [page, setPage] = useState<Page | null>(null);
  const [scmOpen, setScmOpen] = useState(false);
  // GIT-004: a half-written commit message per worktree, kept through closing the panel.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // EDIT-033: the explorer on the right; closed at start (DT-R17). A bump of explorerFocus moves focus into its tree.
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [explorerFocus, setExplorerFocus] = useState(0);
  const toggleExplorer = () => {
    if (explorerOpen && document.activeElement?.closest(".explorer")) return setExplorerOpen(false);
    setScreen("terminals");
    setExplorerOpen(true);
    setExplorerFocus((n) => n + 1);
  };
  const [panes, setPanes] = useState<Pane[]>([{ key: 1, cwd: null, branch: null, agent: "shell", program: null, args: [] }]);
  const [focused, setFocused] = useState(1);
  // TERM-040: which tab each cell shows; the focused pane's tab comes to the front, and a cell
  // whose active tab was closed falls back to its last tab.
  const [activeTab, setActiveTab] = useState<Record<number, number>>({});
  useEffect(() => {
    const p = panes.find((x) => x.key === focused);
    if (p) setActiveTab((m) => (m[groupOf(p)] === focused ? m : { ...m, [groupOf(p)]: focused }));
  }, [focused, panes]);
  // The workspace the grid shows; null is the home group (panes opened in no workspace).
  const [activeDir, setActiveDir] = useState<string | null>(null);
  const [running, setRunning] = useState<Record<number, boolean>>({});
  const [needs, setNeeds] = useState<Record<number, boolean>>({}); // TERM-030: panes waiting on the user
  const runRef = useRef(running); // TERM-118: the last reported running flags, to see a finish
  runRef.current = running;
  const [unreadPanes, setUnreadPanes] = useState<Set<number>>(new Set()); // TERM-118: finished or rang out of view
  const [unreadDirs, setUnreadDirs] = useState<Set<string>>(new Set()); // PROJ-063 / TERM-118: workspace rows marked unread
  const [winFocused, setWinFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const on = () => setWinFocused(true);
    const off = () => setWinFocused(false);
    window.addEventListener("focus", on);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("focus", on);
      window.removeEventListener("blur", off);
    };
  }, []);
  const markDir = (dir: string, un: boolean) => setUnreadDirs((u) => new Set(un ? [...u, dir] : [...u].filter((d) => !sameDir(d, dir))));
  const rowRef = useRef<Record<string, RowInfo>>({}); // PROJ-063: each folder's last row state, to keep its `changed` time
  const ptys = useRef<Record<number, number>>({}); // TERM-045: each pane's session id
  const [asking, setAsking] = useState<{ keys: number[]; title: string; body: string } | null>(null);
  const [titles, setTitles] = useState<Record<number, string>>({}); // browser tabs' page titles
  const [allAgents, setAgents] = useState<AgentInfo[]>([]);
  const [agentPass, setAgentPass] = useState<AgentPass>(FIRST_PASS); // SESS-002
  const [shells, setShells] = useState<ShellInfo[]>([]); // SESS-006
  const [settings, setSettings] = useState<Record<string, unknown>>(initial);
  const classic = readLook(settings) === "classic";
  // SET-027: everywhere but Settings, only agents that are switched on are offered.
  const agents = useMemo(() => offeredAgents(allAgents, settings), [allAgents, settings]);
  const [dirty, setDirty] = useState<Record<number, boolean>>({}); // EDIT-001: editor tabs with unsaved text
  const [picking, setPicking] = useState<"file" | "markdown" | "change" | null>(null); // EDIT-036 / EDIT-012 / EDIT-027: which file picker is open
  const defaultId = defaultAgentId(settings);
  const installedIds = agents.filter((a) => a.installed).map((a) => a.id);
  const [projects, setProjects] = useState<Project[]>([]);
  const [owner, setOwner] = useState<Record<string, string>>({});
  const [refresh, setRefresh] = useState(0);
  const [deleteRequest, setDeleteRequest] = useState(0); // PROJ-070: Mod+Shift+Backspace asks to delete the shown workspace
  const recentDirs = useRef<string[]>([]); // PROJ-070: workspaces shown, newest first
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeDir;
  const [createRequest, setCreateRequest] = useState(0); // PROJ-020: Mod+N opens the sidebar's name field
  const [createName, setCreateName] = useState(""); // PROJ-057: the palette's typed name, prefilled there
  const [palette, setPalette] = useState(false); // PROJ-057 / VIEW-037: the worktree palette is open
  const [hist, setHist] = useState(EMPTY_HISTORY); // VIEW-046: workspaces and pages shown, for back and forward
  const [launching, setLaunching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // A toast is a passing note (SESS-024 "starting 3 sessions"); it clears itself.
  const [toast, setToastText] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const setToast = (text: string) => {
    setToastText(text);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastText(null), 4000);
  };
  const nextKey = useRef(2);

  useEffect(() => {
    invoke<AppInfo>("app_info").then(setInfo).catch(() => setInfo(null));
    refreshAgents();
    invoke<ShellInfo[]>("shell_list").then(setShells, () => setShells([]));
    // SET-027: Refresh on the Agents page looks again; the window takes the list it found, so
    // one refresh is one search (SESS-002).
    // An install that finished (SET-026) says so with no list: the window searches once for everyone.
    const offAgents = listen<AgentInfo[] | null>("agents-changed", (e) => {
      if (!Array.isArray(e.payload)) return refreshAgents();
      setAgents(e.payload);
      setAgentPass({ looking: false, done: true, error: null });
    });
    // SET-001: the saved look is put on the window every time the settings are read.
    const readSettings = () =>
      void invoke<Record<string, unknown>>("get_settings")
        .then((s) => {
          setSettings(s);
          applyAppearance(readAppearance(s));
        })
        .catch(() => setSettings({}));
    readSettings();
    const off = listen("settings-saved", readSettings);
    return () => {
      void off.then((u) => u()).catch(() => {});
      void offAgents.then((u) => u()).catch(() => {});
    };
  }, []);

  // SESS-002: one refresh is one search. An errored search keeps the last list but blocks
  // launching until a search succeeds; nothing counts as missing before the first one is done.
  function refreshAgents() {
    setAgentPass((p) => ({ ...p, looking: true }));
    invoke<AgentInfo[]>("agent_list").then(
      (list) => {
        setAgents(list);
        setAgentPass({ looking: false, done: true, error: null });
        void emit("agents-changed", list).catch(() => {});
      },
      (err) => setAgentPass((p) => ({ ...p, looking: false, error: String(err) || "the search failed" })),
    );
  }
  // SESS-002 / SESS-003: once a search is done, a seat whose agent is gone (or switched off) is
  // emptied for good, never refilled when the agent comes back.
  const offeredKey = installedIds.join(",");
  useEffect(() => {
    if (!agentPass.done || agentPass.error) return;
    setPanes((ps) => {
      let changed = false;
      const next = ps.map((p) => {
        if (!p.seats) return p;
        const seats = clearMissing(p.seats, installedIds);
        if (seats.every((s, i) => s === p.seats![i])) return p;
        changed = true;
        return { ...p, seats };
      });
      return changed ? next : ps;
    });
  }, [agentPass, offeredKey]);

  // SKILL-002: the kit gallery and a kit's setup float over every screen; any part of the app opens
  // the gallery with the kolux-open-kits event.
  const [kits, setKits] = useState<{ kit: string | null; sampleDir: string | null } | null>(null);
  const [samplesBusy, setSamplesBusy] = useState(false);
  const [kitConflict, setKitConflict] = useState<string | null>(null);
  // SKILL-006 / SKILL-008: each folder's kit run in this window: its start, the seats in role order
  // (null when not every seat started), the roles still waiting and when each waiting one was sent.
  const kitRuns = useRef<Record<string, KitRun>>({});
  const [kitTick, setKitTick] = useState(0);
  const [kitFolded, setKitFolded] = useState(false);
  useEffect(() => {
    const show = () => setKits((k) => k ?? { kit: null, sampleDir: null });
    window.addEventListener(OPEN_KITS, show);
    return () => window.removeEventListener(OPEN_KITS, show);
  }, []);
  // SKILL-003: Claude, Codex and Grok, when found and not switched off, can take kit roles.
  const kitAIs = useMemo(() => VENDORS.filter((v) => agents.some((a) => a.id === v && a.installed)), [agents]) as Vendor[];
  const pickKit = (id: string) => {
    setKitConflict(null);
    setKits({ kit: id, sampleDir: null });
    invoke<string>("kit_samples_dir", { kit: id }).then((d) => setKits((k) => (k?.kit === id ? { ...k, sampleDir: d } : k)), () => {});
  };
  const trySamples = (id: string) => {
    setSamplesBusy(true);
    invoke<{ path: string; name: string }>("kit_samples", { kit: id })
      .then((p) => {
        setRefresh((n) => n + 1);
        select(p.path, null);
      })
      .catch((err) => setToast(`Kolux could not set up the sample data: ${String(err)}`))
      .finally(() => setSamplesBusy(false));
  };
  const saveSetting = (key: string, value: unknown) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    invoke("save_settings", { value: next }).catch((err) => setNotice(String(err)));
  };
  // SESS-004: the default agent is a settings key; the plus menu lists it first.
  const setDefault = (id: string) => saveSetting(DEFAULT_AGENT_KEY, id);
  useEffect(() => {
    document.title = windowTitle(info);
  }, [info]);
  // BROW-001: a browser tab is named after its page.
  useEffect(() => {
    const off = listen<{ id: number; title: string }>("browser-title", (e) => setTitles((t) => ({ ...t, [e.payload.id]: e.payload.title })));
    return () => void off.then((u) => u());
  }, []);

  // T-005: the shortcuts file is read at start; what it got wrong is said once, in the notice.
  const keymapNotice = keymap.errors.join(" ");
  useEffect(() => {
    if (keymapNotice) setNotice(keymapNotice);
  }, [keymapNotice]);
  // SET-037: under Classic there is only the Terminals screen.
  useEffect(() => {
    if (classic) setScreen("terminals");
  }, [classic]);
  // SET-006: a link anywhere in the app opens Settings at its page and section.
  useEffect(() => {
    const open = (e: Event) => {
      setSettingsAt((a) => ({ target: (e as CustomEvent<SettingsTarget>).detail, n: a.n + 1 }));
      setSettingsOpen(true);
    };
    window.addEventListener(OPEN_SETTINGS, open);
    return () => window.removeEventListener(OPEN_SETTINGS, open);
  }, []);

  // Global-scope shortcuts are pressed here, wherever focus is (the terminal policy comes with
  // SET-014). Only actions that exist today do something; the rest are matched and left alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const kind = screen === "terminals" ? panes.find((p) => p.key === focused)?.kind : undefined;
      const inTree = !!document.activeElement?.closest(".explorer"); // the explorer's own keys (EDIT-034) come with T-094-b
      // EDIT-001: in an editor the editor shortcuts come first and terminal ones do not apply;
      // the ones Kolux has no action for yet are left to CodeMirror.
      const hit =
        (kind === "browser" && matchEvent(keymap, e, ["browser"])) ||
        matchEvent(keymap, e, inTree ? ["global"] : kind === "editor" || kind === "diff" ? ["editor", "global", "tabs"] : kind === "preview" ? ["global", "tabs"] : screen === "terminals" ? ["global", "terminal", "tabs"] : ["global"]);
      if (!hit) return;
      const inFront = panesIn(panes, activeDir).some((p) => p.key === focused);
      const inBrowser = (sel: string) => document.querySelector<HTMLElement>(`.pane.browser[data-key="${focused}"] ${sel}`);
      switch (hit.id) {
        case "browser.focusAddressBar": {
          const bar = inBrowser(".address") as HTMLInputElement | null;
          bar?.focus();
          bar?.select();
          break;
        }
        case "browser.back":
        case "browser.forward":
          inBrowser(`[data-go="${hit.id.slice("browser.".length)}"]`)?.click();
          break;
        case "browser.reload":
          void invoke("browser_go", { id: focused, what: "reload" });
          break;
        case "app.settings":
          if (!settingsOpen) setSettingsAt((a) => ({ target: null, n: a.n }));
          setSettingsOpen(true);
          break;
        case "editor.save": {
          const save = editors.get(focused);
          if (!save) return;
          void save();
          break;
        }
        case "sidebar.explorer.toggle":
          toggleExplorer();
          break;
        case "sidebar.left.toggle":
          setSidebarOpen((o) => !o);
          break;
        case "sidebar.sourceControl.toggle":
        case "sidebar.right.toggle":
          // ponytail: the right sidebar holds only Source Control until VIEW-056/057 (T-146).
          setScreen("terminals");
          setScmOpen((o) => !o);
          break;
        case "workspace.delete":
          setScreen("terminals");
          setSidebarOpen(true);
          setDeleteRequest((n) => n + 1);
          break;
        case "workspace.create":
          setScreen("terminals");
          setSidebarOpen(true);
          setCreateName("");
          setCreateRequest((n) => n + 1);
          break;
        case "worktree.palette":
          setPalette(true);
          break;
        // PROJ-055 / VIEW-046: keyboard moves follow the sidebar list as shown (a project's main
        // checkout row, then its workspace rows), so folded rows are skipped; the sidebar is
        // brought up first so there is a list to follow.
        case "worktree.navigateUp":
        case "worktree.navigateDown":
        case "workspace.selectByIndex":
        case "sidebar.focusWorktreeList": {
          flushSync(() => {
            setScreen("terminals");
            setSidebarOpen(true);
          });
          const rows = [...document.querySelectorAll<HTMLElement>(".sidebar :is(button.branch, .sess[role=button])")];
          const at = rows.findIndex((r) => r.classList.contains("sel"));
          if (hit.id === "sidebar.focusWorktreeList") {
            rows[Math.max(at, 0)]?.focus();
            break;
          }
          const i = navTarget(rows.length, at, hit.id === "workspace.selectByIndex" ? { index: hit.index ?? 0 } : { step: hit.id === "worktree.navigateDown" ? 1 : -1 });
          if (i === null) return;
          rows[i].click();
          rows[i].scrollIntoView({ block: "nearest" });
          break;
        }
        case "worktree.history.back":
        case "worktree.history.forward":
          if (!step(hit.id === "worktree.history.back" ? -1 : 1)) return;
          break;
        case "view.cycleWorkspaceView":
          if (!classic) setScreen((s) => nextScreen(s));
          break;
        case "tab.newTerminal":
          void newTab(null);
          break;
        case "tab.newBrowser":
          void newTab("browser");
          break;
        case "editor.nextChange":
        case "editor.previousChange": {
          const step = diffNav.get(focused);
          if (!step) return;
          step(hit.id === "editor.nextChange" ? 1 : -1);
          break;
        }
        case "editor.markdownPreview": {
          const p = panes.find((x) => x.key === focused);
          if (!p?.path || !isMarkdown(p.path)) return;
          openPreview(p.path);
          break;
        }
        case "worktree.quickOpen":
          if (!activeDir) setToast("Open a workspace to find a file in it.");
          else setPicking("file");
          break;
        case "tab.openMarkdown":
          void newTab("markdown-open");
          break;
        case "tab.newMarkdown":
          void newTab("markdown-new");
          break;
        case "sessions.add":
          addChooser();
          break;
        case "sessions.remove":
          removeSession();
          break;
        case "tab.newAgent": {
          if (agentPass.error) {
            setNotice(`Kolux could not look for agents (${agentPass.error}). Refresh agents, then try again.`);
            break;
          }
          // SET-027 / SESS-010: with no default, the first agent available
          const a = defaultId ? agents.find((x) => x.id === defaultId && x.installed) : agents.find((x) => x.installed);
          if (!a) setNotice(defaultId ? `The default agent (${defaultId}) is not installed or is switched off.` : "No agent is installed and switched on.");
          else void newTab(a);
          break;
        }
        case "tab.close":
        case "terminal.closePane":
          if (!inFront) return;
          closePane(focused);
          break;
        case "terminals.focusNextNeedsYou": {
          // TERM-030: cycle through the panes waiting on the user in grid order, across workspaces;
          // with none waiting, focus stays where it is.
          const k = nextNeedsYou(panes.filter((p) => p.kind !== "browser").map((p) => p.key), new Set(Object.keys(needs).filter((x) => needs[Number(x)]).map(Number)), focused);
          if (k === null) return;
          const p = panes.find((x) => x.key === k);
          if (p && !sameDir(p.cwd, activeDir)) setActiveDir(p.cwd);
          setFocused(k);
          break;
        }
        case "terminal.splitRight":
        case "terminal.splitDown":
          if (!inFront) return;
          splitPane(focused, hit.id === "terminal.splitRight" ? "right" : "down");
          break;
        default: {
          // TERM-041: one unbound command per installed agent, `tab.newAgent.<id>`.
          const id = hit.id.startsWith("tab.newAgent.") ? hit.id.slice("tab.newAgent.".length) : null;
          const a = id ? agents.find((x) => x.id === id && x.installed) : undefined;
          if (!a) return;
          void newTab(a);
        }
      }
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const addShell = (dir: string | null, branch: string | null) => {
    const key = nextKey.current++;
    setPanes((ps) => [...ps, { key, cwd: dir, branch, agent: "shell", program: null, args: [] }]);
    setFocused(key);
  };

  // SESS-007: a pane that asks what to run, in the workspace in front. SESS-008: a grid holds
  // up to MAX_PANES.
  const addChooser = () => {
    if (cellsOf(panesIn(panes, activeDir)).length >= MAX_PANES) return setToast(`A workspace holds up to ${MAX_PANES} panes.`);
    const key = nextKey.current++;
    setPanes((ps) => [...ps, { key, cwd: activeDir, branch: null, agent: "shell", program: null, args: [], seats: [emptySeat()] }]);
    setFocused(key);
  };
  // SESS-008: the remove-session shortcut closes the newest chooser pane in front without asking;
  // with none, the focused session, which asks first (once) when a program would stop. A lone
  // chooser stays, so the grid never drops below one pane.
  const removeSession = () => {
    const t = removeTarget(panesIn(panes, activeDir), focused);
    if (!t) return;
    if (t.chooser) dropPane(t.key);
    else if (!asking) closePane(t.key); // at most one question per press
  };
  // TERM-040 / TERM-041: a new tab joins the focused pane's cell (or opens its own cell) and
  // starts in the workspace folder; an agent tab runs the agent's start line there. Outside any
  // workspace an agent has no folder to work in, so it gets a fresh worktree instead (SESS-004).
  const newTab = async (what: NewTab) => {
    if (what === "diff") {
      if (!activeDir) setToast("Open a workspace to pick one of its changed files.");
      else setPicking("change");
      return;
    }
    if (what === "changes") {
      // EDIT-029: one All Changes tab per cell; an open one comes to the front.
      if (!activeDir) return setToast("Open a workspace to see its changes.");
      const here = panes.find((p) => p.key === focused && sameDir(p.cwd, activeDir));
      const same = here && panes.find((p) => p.kind === "changes" && groupOf(p) === groupOf(here));
      if (same) return setFocused(same.key);
      const key = nextKey.current++;
      setPanes((ps) => [...ps, { key, cwd: activeDir, branch: here?.branch ?? null, group: here ? groupOf(here) : undefined, agent: "shell", program: null, args: [], kind: "changes" }]);
      setFocused(key);
      return;
    }
    if (what === "chooser") return addChooser();
    if (what === "markdown-open") {
      if (!activeDir) setToast("Open a workspace to pick from its markdown files.");
      else setPicking("markdown");
      return;
    }
    if (what === "markdown-new") {
      if (!activeDir) setToast("Open a workspace to start a markdown note in it.");
      else invoke<string>("md_new", { root: activeDir }).then(openFile, (err) => setToast(String(err)));
      return;
    }
    if (what !== null && typeof what === "object" && "shell" in what) {
      // SESS-006: another installed shell, as a tab beside the focused pane.
      const here = panes.find((p) => p.key === focused && sameDir(p.cwd, activeDir));
      const key = nextKey.current++;
      setPanes((ps) => [...ps, { key, cwd: activeDir, branch: here?.branch ?? null, group: here ? groupOf(here) : undefined, agent: "shell", program: what.shell.program, args: what.shell.args, word: what.shell.name }]);
      setFocused(key);
      return;
    }
    if (what === "file") {
      const path = await open({ multiple: false, directory: false, defaultPath: activeDir ?? undefined, title: "Open a file" }).catch(() => null);
      if (typeof path === "string") openFile(path);
      return;
    }
    const a = what === "browser" ? null : what;
    if (a && activeDir === null) return launch(a, null);
    const here = panes.find((p) => p.key === focused && sameDir(p.cwd, activeDir));
    const key = nextKey.current++;
    const base = { key, cwd: activeDir, branch: here?.branch ?? null, group: here ? groupOf(here) : undefined };
    if (what === "browser") {
      // BROW-001: a New Tab in the focused split, selected straight away.
      setPanes((ps) => [...ps, { ...base, agent: "shell", program: null, args: [], kind: "browser" }]);
      setFocused(key);
      return;
    }
    try {
      if (a) await pretrust(a.id, [activeDir]);
      const line = a ? await invoke<StartLine>("agent_start_line", { id: a.id, extra: [], prompt: "" }) : null;
      const pane: Pane = a && line ? { ...base, agent: markFor(a.id), program: line.program ?? a.program, args: line.args, env: line.env, typed: line.typed ?? undefined } : { ...base, agent: "shell", program: null, args: [] };
      setPanes((ps) => [...ps, pane]);
      setFocused(key);
    } catch (err) {
      setNotice(String(err));
    }
  };

  // EDIT-001: a file opens as a tab beside the focused pane; a file already open in that cell
  // comes to the front instead of opening twice.
  const openFile = (path: string) => {
    const here = panes.find((p) => p.key === focused && sameDir(p.cwd, activeDir));
    const same = here && panes.find((p) => p.kind === "editor" && groupOf(p) === groupOf(here) && keyOf(p.path ?? "") === keyOf(path));
    if (same) return setFocused(same.key);
    const key = nextKey.current++;
    setPanes((ps) => [...ps, { key, cwd: activeDir, branch: here?.branch ?? null, group: here ? groupOf(here) : undefined, agent: "shell", program: null, args: [], kind: "editor", path }]);
    setFocused(key);
  };

  // EDIT-027: a changed file's diff opens as a tab beside the focused pane; its staged and
  // unstaged diffs are separate tabs, and one already open in that cell comes to the front.
  const openDiff = (path: string, staged: boolean) => {
    const here = panes.find((p) => p.key === focused && sameDir(p.cwd, activeDir));
    const same = here && panes.find((p) => p.kind === "diff" && !!p.staged === staged && groupOf(p) === groupOf(here) && keyOf(p.path ?? "") === keyOf(path));
    if (same) return setFocused(same.key);
    const key = nextKey.current++;
    setPanes((ps) => [...ps, { key, cwd: activeDir, branch: here?.branch ?? null, group: here ? groupOf(here) : undefined, agent: "shell", program: null, args: [], kind: "diff", path, staged }]);
    setFocused(key);
  };

  // EDIT-012: Mod+Shift+V shows the file in a read-only preview tab beside it; a preview tab
  // already in that cell is reused for the new file.
  const openPreview = (path: string) => {
    const here = panes.find((p) => p.key === focused && sameDir(p.cwd, activeDir));
    const old = here && panes.find((p) => p.kind === "preview" && groupOf(p) === groupOf(here));
    if (old) {
      setPanes((ps) => ps.map((p) => (p.key === old.key ? { ...p, path } : p)));
      return setFocused(old.key);
    }
    const key = nextKey.current++;
    setPanes((ps) => [...ps, { key, cwd: activeDir, branch: here?.branch ?? null, group: here ? groupOf(here) : undefined, agent: "shell", program: null, args: [], kind: "preview", path }]);
    setFocused(key);
  };

  // TERM-001: the layout strip sets how many cells the workspace in front holds. Growing adds
  // empty chooser panes (nothing starts on its own); shrinking drops unstarted cells newest
  // first and leaves started sessions alone (TERM-003's ask comes with its own task).
  const setCount = (n: number) => {
    const shown = cellsOf(panesIn(panes, activeDir));
    const { add, drop } = resizePlan(shown.map((c) => ({ key: c.group, started: c.panes.some((p) => !p.seats) })), n);
    if (add === 0 && drop.length === 0 && clampCount(n) < shown.length) {
      setToast(`All ${shown.length} panes here are started sessions. Close one to go smaller.`);
      return;
    }
    const fresh: Pane[] = Array.from({ length: add }, () => ({ key: nextKey.current++, cwd: activeDir, branch: null, agent: "shell", program: null, args: [], seats: [emptySeat()] }));
    const rest = panes.filter((p) => !drop.includes(groupOf(p)));
    setPanes([...rest, ...fresh]);
    setFocused((f) => (drop.includes(f) ? focusIn(rest, activeDir, f) : f));
  };

  // TERM-006: a split opens a shell in the pane's own folder, beside it (right) or under it.
  const splitPane = (key: number, dir: "right" | "down") => {
    const src = panes.find((p) => p.key === key);
    if (!src) return;
    const shown = cellsOf(panesIn(panes, activeDir));
    if (shown.length >= MAX_PANES) {
      setToast(`A workspace holds up to ${MAX_PANES} panes.`);
      return;
    }
    const pane: Pane = { key: nextKey.current++, cwd: src.cwd, branch: src.branch, agent: "shell", program: null, args: [] };
    const at = splitIndex(shown.map((c) => c.group), groupOf(src), dir, columnsFor(shown.length + 1));
    setPanes(insertBefore(panes, shown[at]?.panes[0], pane));
    setFocused(pane.key);
  };

  const setSeats = (key: number, seats: Seat[]) => setPanes((ps) => ps.map((p) => (p.key === key ? { ...p, seats } : p)));
  const setChooser = (key: number, patch: Partial<Pane>) => setPanes((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  // SESS-021: a lineup is kept per project once one of its agent seats has really started (its
  // pane reports a running program); until then it waits here under its batch.
  const pendingLineup = useRef<Record<number, { pid: string; lineup: Lineup }>>({});
  const lineupsOf = (s: Record<string, unknown>) => (s[LAST_LINEUP_KEY] ?? {}) as Record<string, Lineup>;
  const rememberLineup = (batch: number) => {
    const wait = pendingLineup.current[batch];
    if (!wait) return;
    delete pendingLineup.current[batch];
    void invoke<Record<string, unknown>>("get_settings")
      .then((s) => {
        const next = { ...s, [LAST_LINEUP_KEY]: { ...lineupsOf(s), [wait.pid]: wait.lineup } };
        setSettings(next);
        return invoke("save_settings", { value: next });
      })
      .catch((err) => setNotice(String(err)));
  };

  // SESS-014: a chooser can copy only inside a Git project: its workspace, or (outside any
  // workspace) the registered projects.
  const inGitFor = (p: Pane) => p.cwd !== null || projects.length > 0;

  // Start replaces the chooser with one pane per seat (SESS-013). With separate copies (SESS-014)
  // every agent seat gets a fresh creature-named worktree of its own (SESS-023), made one after
  // another so no two pick one name; with the shared folder agent seats run in the chooser's
  // workspace, or in one fresh worktree together when the chooser sits outside any workspace.
  // Terminal seats always open in the chooser's folder. A seat's first message is its role's brief,
  // the shared task and its own prompt (SESS-012); with two or more AI seats each also gets the
  // rules block and a handoff note made before it starts (SESS-025), in the project's main checkout
  // (or the chooser's folder outside any project), named after its worktree, or after the folder
  // and its seat number when the seats share one folder.
  const startSeats = async (key: number, seats: Seat[]) => {
    const chooser = panes.find((p) => p.key === key);
    if (!chooser) return;
    setLaunching(true);
    try {
      const picked = seats.map((s) => (s.agent === TERMINAL ? null : agents.find((a) => a.id === s.agent && a.installed) ?? null));
      const missing = seats.find((s, i) => s.agent !== TERMINAL && !picked[i]);
      if (missing) throw new Error(`${missing.agent} is not installed.`);
      const separate = inGitFor(chooser) && (chooser.copies ?? defaultCopies(seats.length, inGitFor(chooser))) === "separate";
      const pid = projectOf(chooser.cwd) ?? projectFor(null);
      const fresh = async (): Promise<{ cwd: string; branch: string | null }> => {
        if (!pid) throw new Error("Add a project first: an agent needs a repository to work in.");
        const wt = await invoke<Worktree>("workspace_create_fresh", { projectId: pid });
        return { cwd: wt.path, branch: wt.branch };
      };
      const places: { cwd: string | null; branch: string | null }[] = [];
      let shared: { cwd: string | null; branch: string | null } | null = null;
      for (const a of picked) {
        if (a === null) places.push({ cwd: chooser.cwd, branch: chooser.branch });
        else if (separate) places.push(await fresh());
        else places.push((shared ??= chooser.cwd === null ? await fresh() : { cwd: chooser.cwd, branch: chooser.branch }));
      }
      const batch = key;
      for (const id of new Set(picked.flatMap((a) => (a ? [a.id] : [])))) await pretrust(id, picked.map((a, i) => (a?.id === id ? places[i].cwd : null)));
      // SESS-051: each agent's start line comes from the catalogue, prompt route included; a
      // refused line (Hermes past its limit) stops the whole Start before any pane is made.
      const side = picked.filter(Boolean).length >= 2;
      const root = projects.find((p) => p.id === pid)?.path ?? chooser.cwd;
      if (side && !root) throw new Error("Add a project first: agents side by side keep their handoff notes in it.");
      const task = chooser.task ?? "";
      const prompts: string[] = [];
      for (const [i, a] of picked.entries()) {
        const cwd = places[i].cwd ?? "";
        const note = a && side ? await invoke<string>("handoff_note_prepare", { root, name: separate ? folderName(cwd) : `${folderName(cwd)}-seat-${i + 1}` }) : null;
        prompts.push(a ? openingPrompt(seats[i], task, note && rulesBlock(note)) : "");
      }
      const lines = await Promise.all(picked.map((a, i) => (a ? invoke<StartLine>("agent_start_line", { id: a.id, extra: seatArgs(seats[i]), prompt: prompts[i], picked: true }) : null)));
      const made: Pane[] = seats.map((s, i) => {
        const a = picked[i];
        const line = lines[i];
        const k = nextKey.current++;
        const title = s.title?.trim() || (s.role && s.role[0].toUpperCase() + s.role.slice(1)) || undefined;
        const { cwd, branch } = places[i];
        return a && line
          ? { key: k, cwd, branch, agent: markFor(a.id), program: line.program ?? a.program, args: line.args, env: line.env, title, batch, typed: line.typed ?? undefined }
          : { key: k, cwd, branch, agent: "shell", program: null, args: [], title, batch };
      });
      if (pid && picked.some(Boolean)) pendingLineup.current[batch] = { pid, lineup: lineupOf(chooser.shape ?? "custom", separate ? "separate" : "shared", seats) };
      setPanes((ps) => ps.flatMap((p) => (p.key === key ? made : [p])));
      setToast(made.length === 1 ? "Starting 1 session" : `Starting ${made.length} sessions`);
      setActiveDir(made[0].cwd);
      setFocused(made[0].key);
      setRefresh((n) => n + 1);
      setNotice(null);
    } catch (err) {
      setNotice(String(err));
    } finally {
      setLaunching(false);
    }
  };

  // PROJ-038: the agent is the new workspace's first tab, started with its prompt; nothing else
  // opens there. Shown only when the sidebar says the user has not moved on.
  const startIn = async (agent: AgentInfo, dir: string, branch: string | null, prompt: string, show: boolean, extra: string[] = [], title?: string): Promise<number | null> => {
    try {
      await pretrust(agent.id, [dir]);
      const line = await invoke<StartLine>("agent_start_line", { id: agent.id, extra, prompt });
      const key = nextKey.current++;
      setPanes((ps) => [...ps, { key, cwd: dir, branch, agent: markFor(agent.id), program: line.program ?? agent.program, args: line.args, env: line.env, title, typed: line.typed ?? undefined }]);
      if (show) {
        setActiveDir(dir);
        setFocused(key);
      }
      return key;
    } catch (err) {
      setNotice(String(err));
      return null;
    }
  };

  // PROJ-066: a click on a workspace row shows that workspace on the same click. Its panes were
  // kept while hidden, so they come back as they were; a workspace with no pane yet gets a shell.
  const select = (dir: string, branch: string | null) => {
    setPage(null);
    recentDirs.current = [dir, ...recentDirs.current.filter((d) => !sameDir(d, dir))].slice(0, 20);
    setActiveDir(dir);
    if (screen === "artifacts") setScreen("terminals");
    if (panesIn(panes, dir).length > 0) setFocused((f) => focusIn(panes, dir, f));
    else addShell(dir, branch);
  };

  // VIEW-046: every workspace and page shown is a stop for back and forward; a step back lands on
  // the place already current, which visit leaves alone.
  useEffect(() => setHist((h) => visit(h, { dir: activeDir, page })), [activeDir, page]);
  // Deleted workspaces are skipped: a place counts while some project still lists its folder.
  const stillThere = (p: Place) => p.dir === null || Object.keys(owner).some((d) => sameDir(d, p.dir));
  const step = (dir: 1 | -1) => {
    const i = travel(hist, dir, stillThere);
    if (i === null) return false;
    const p = hist.list[i];
    setHist({ ...hist, at: i });
    setScreen("terminals");
    if (p.dir === null) setActiveDir(null);
    else if (!sameDir(p.dir, activeDir)) select(p.dir, null);
    setPage(p.page as Page | null);
    return true;
  };
  // PROJ-057 / VIEW-037: the palette's rows besides worktrees and projects.
  const paletteItems = (): PaletteItem[] => [
    ...panes
      .filter((p) => !p.seats)
      .map((p) => ({
        section: "Open tabs",
        label: tabName(p, titles),
        hint: p.cwd ? folderName(p.cwd) : "Home",
        run: () => {
          setScreen("terminals");
          if (!sameDir(p.cwd, activeDir)) {
            setPage(null);
            setActiveDir(p.cwd);
          }
          setFocused(p.key);
        },
      })),
    ...(Object.keys(PAGES) as PageId[]).map((id) => ({ section: "Settings", label: PAGES[id], hint: "Settings page", run: () => openSettings(id) })),
    { section: "Quick actions", label: "New terminal tab", run: () => void newTab(null) },
    { section: "Quick actions", label: "New session", run: () => addChooser() },
    {
      section: "Quick actions",
      label: "New workspace",
      run: () => {
        setScreen("terminals");
        setSidebarOpen(true);
        setCreateName("");
        setCreateRequest((n) => n + 1);
      },
    },
  ];

  // PROJ-066: removing a workspace closes every pane in it, wherever it was; the view stays
  // unless it was the one removed, then it falls back to the home group.
  // PROJ-070: the removed one gives way to the sibling used last that still has panes; the shown
  // workspace is read when the delete finishes, so a user who went elsewhere meanwhile stays there.
  const removed = (path: string) => {
    const left = withoutDir(panes, path);
    const pid = projectOf(path);
    const siblings = Object.entries(owner).filter(([d, p]) => p === pid && !sameDir(d, path) && panesIn(left, d).length > 0).map(([d]) => d);
    const next = activeAfterRemove(activeRef.current, path, recentDirs.current, siblings);
    setPanes(left);
    setActiveDir(next);
    setFocused((f) => focusIn(left, next, f));
  };

  // PROJ-077: a workspace made or removed from the command line shows up like one made here;
  // the handlers are read through a ref so the one listener never goes stale.
  const cli = useRef({ startIn, select, removed });
  cli.current = { startIn, select, removed };
  useEffect(() => {
    const off = listen<CliWorkspace>("cli-workspace", (e) => {
      const p = e.payload;
      setRefresh((n) => n + 1);
      if (p.kind === "removed") {
        cli.current.removed(p.path);
        return;
      }
      // ORCH-016: a worker starts as a background tab in its worktree, named after its task.
      if (p.kind === "start") {
        const a = agents.find((x) => x.id === p.agent);
        if (a) void cli.current.startIn(a, p.path, p.branch, p.prompt, false, p.extra, p.title ?? undefined);
        return;
      }
      const a = p.agent ? agents.find((x) => x.id === p.agent) : undefined;
      if (a) void cli.current.startIn(a, p.worktree.path, p.worktree.branch, p.prompt, p.activate);
      else if (p.activate) cli.current.select(p.worktree.path, p.worktree.branch);
    });
    return () => {
      off.then((f) => f()).catch(() => undefined);
    };
  }, [agents]);

  // Which project a launch belongs to: the one asked for, else the one that owns the focused
  // pane's folder, else the first in the list.
  // SAFE-023 / SAFE-024: every folder a launch will use (and its main repository) is marked
  // trusted in the agent's own configuration in one write before any agent process starts; best
  // effort, a failure never stops the launch.
  const pretrust = async (agent: string, dirs: (string | null)[]) => {
    const paths = [...new Set(dirs.flatMap((d) => (d === null ? [] : [d, projects.find((p) => p.id === projectOf(d))?.path])).filter((p): p is string => typeof p === "string"))];
    if (paths.length === 0) return;
    try {
      await invoke("trust_folders_cmd", { agent, paths });
    } catch (err) {
      console.warn(`trust: ${String(err)}`);
    }
  };
  // GIT-004: a refused commit can be handed to the default agent with the hook's own words.
  const fixWithAI = (output: string) => {
    const a = agents.find((x) => x.id === defaultId && x.installed);
    if (!a || activeDir === null) {
      setNotice(`The default agent (${defaultId}) is not installed.`);
      return;
    }
    const prompt = `A git action in this workspace failed. Find the cause, fix it, and finish the action.\n\nGit said:\n${output}`;
    void startIn(a, activeDir, panesIn(panes, activeDir)[0]?.branch ?? null, prompt, true);
  };
  const projectOf = (cwd: string | null): string | null => (cwd ? (Object.entries(owner).find(([dir]) => sameDir(dir, cwd))?.[1] ?? null) : null);
  const projectFor = (projectId: string | null): string | null => projectId ?? projectOf(panes.find((p) => p.key === focused)?.cwd ?? null) ?? projects[0]?.id ?? null;

  // SESS-004 + SESS-023: a fresh worktree with a creature name, then the agent in a new pane there.
  const launch = async (agent: AgentInfo, projectId: string | null) => {
    const pid = projectFor(projectId);
    if (!pid) {
      setNotice("Add a project first: an agent needs a repository to work in.");
      return;
    }
    setLaunching(true);
    try {
      const wt = await invoke<Worktree>("workspace_create_fresh", { projectId: pid });
      const key = nextKey.current++;
      setPanes((ps) => [...ps, { key, cwd: wt.path, branch: wt.branch, agent: markFor(agent.id), program: agent.program, args: agent.args }]);
      setActiveDir(wt.path);
      setFocused(key);
      setRefresh((n) => n + 1);
      setNotice(null);
    } catch (err) {
      setNotice(String(err));
    } finally {
      setLaunching(false);
    }
  };

  // SKILL-006: Start kit. One titled seat per role in the project's own checkout (never a
  // worktree), the waiting roles idle with no prompt; earlier results kept in a dated copy and the
  // run recorded first. A folder holding another kit's run asks inline before anything starts.
  const startKit = async (kit: Kit, values: Record<string, string>, assigned: (Vendor | null)[], dir: string) => {
    const before = await invoke<RunCheck | null>("kit_check", { dir }).catch(() => null);
    if (before && before.record.kit !== kit.id && kitConflict === null) {
      const other = KITS.find((k) => k.id === before.record.kit)?.title ?? before.record.title;
      setKitConflict(`This folder holds the results of \u201c${other}\u201d. Starting \u201c${kit.title}\u201d here puts both kits' results side by side.`);
      return;
    }
    setKitConflict(null);
    setKits(null);
    const roles = kit.roles.map((r, i) => ({ id: r.id, ai: assigned[i] ?? "" }));
    const earlierName = datedName(before?.record.title ?? "Earlier run", before?.record.started ?? Date.now());
    const prep = await invoke<{ started: number; earlier: string | null; earlierError: string | null; recordError: string | null }>("kit_prepare", { dir, kit: kit.id, title: kit.title, roles, earlierName }).catch(
      (err) => ({ started: Date.now(), earlier: null, earlierError: null, recordError: String(err) }),
    );
    // An idle, empty first tab is reused for the first seat.
    const here = panesIn(panes, dir);
    const first = here.length === 1 && here[0].agent === "shell" && !here[0].program ? here[0] : null;
    if (first) {
      const id = ptys.current[first.key];
      const busy = id === undefined ? false : await invoke<boolean[]>("terminal_busy", { ids: [id] }).then((b) => b[0], () => true);
      if (!busy) dropPane(first.key);
    }
    const branch = here[0]?.branch ?? null;
    const keys: (number | null)[] = [];
    const waiting: KitWait[] = [];
    for (const [i, role] of kit.roles.entries()) {
      const agent = agents.find((x) => x.id === assigned[i] && x.installed);
      const prompt = rolePrompt(kit, role, values);
      if (!agent) {
        keys.push(null);
        continue;
      }
      const key = await startIn(agent, dir, branch, role.waitsFor ? "" : prompt, i === 0, [], seatTitle(role, agent.id as Vendor));
      keys.push(key);
      if (key !== null && role.waitsFor) waiting.push({ role: role.id, upstream: role.waitsFor, key, prompt });
    }
    const started = keys.filter((k) => k !== null).length;
    if (started === 0) {
      setToast("Not one AI started for the kit, so nothing is running.");
      return;
    }
    // The role-to-session mapping is kept only when every seat started.
    kitRuns.current[dir] = { started: prep.started, seats: started === keys.length ? keys : null, waiting, sent: {} };
    setKitTick((n) => n + 1);
    const words = [`${started} ${started === 1 ? "AI is" : "AIs are"} on the kit; most kits need 5 to 20 minutes.`];
    if (prep.earlier) words.push(`The last run's results were copied to kit-results\\${prep.earlier}.`);
    if (prep.earlierError) words.push(`The last run's results could not be copied: ${prep.earlierError}`);
    if (prep.recordError) words.push(`Kolux could not write the kit's run record, so its results may not be tracked: ${prep.recordError}`);
    if (started < keys.length) words.push(`${keys.length - started} of its roles did not start.`);
    setToast(words.join(" "));
  };

  // SKILL-008: a waiting role gets its prompt once the role it waits on has written this run's
  // marker and its session is found; once only, and a failed send is tried again next time.
  // ponytail: checks every ten seconds (and on any pane state change) while a role waits, whether
  // or not the strip is unfolded; a file watcher would make it instant.
  const sending = useRef(false);
  const pendingKits = Object.values(kitRuns.current).some((r) => r.waiting.length > 0);
  useEffect(() => {
    if (!pendingKits) return;
    const tick = async () => {
      if (sending.current) return;
      sending.current = true;
      try {
        for (const [dir, run] of Object.entries(kitRuns.current)) {
          if (run.waiting.length === 0) continue;
          const check = await invoke<RunCheck | null>("kit_check", { dir }).catch(() => null);
          if (!check || check.record.started !== run.started) continue;
          for (const w of [...run.waiting]) {
            const id = ptys.current[w.key];
            if (!roleDone(check, w.upstream) || id === undefined) continue;
            try {
              await invoke("terminal_write", { id, data: w.prompt });
              await new Promise((r) => setTimeout(r, 300));
              await invoke("terminal_write", { id, data: "\r" });
              run.waiting = run.waiting.filter((x) => x !== w);
              run.sent[w.role] = Date.now();
              setKitTick((n) => n + 1);
            } catch (err) {
              console.warn(`kit: ${String(err)}`);
            }
          }
        }
      } finally {
        sending.current = false;
      }
    };
    void tick();
    const t = window.setInterval(() => void tick(), 10_000);
    return () => window.clearInterval(t);
  }, [pendingKits, kitTick, running, needs]);

  // TERM-014: closing a pane ends its program (the pane's own cleanup kills it); the next tab of
  // its cell takes over, else the neighbouring cells take the space; closing the last pane leaves
  // the workspace's empty placeholder.
  // SESS-024: a pane whose session failed to start goes away, with the reason in a toast.
  const failedPane = (key: number, error: string) => {
    const { panes: rest, batchEmpty } = withoutFailed(panes, key);
    setPanes(rest);
    setFocused((f) => (f === key ? focusIn(rest, activeDir, f) : f));
    setToast(batchEmpty ? `Nothing started: ${error}` : `A session did not start: ${error}`);
  };

  const dropPane = (key: number) => {
    delete ptys.current[key];
    setPanes((ps) => ps.filter((p) => p.key !== key));
    setRunning((r) => {
      const { [key]: _gone, ...rest } = r;
      return rest;
    });
    setDirty((d) => {
      const { [key]: _gone, ...rest } = d;
      return rest;
    });
    const gone = panes.find((p) => p.key === key);
    const rest = panes.filter((p) => p.key !== key);
    const next = gone ? neighbourTab(rest.filter((p) => groupOf(p) === groupOf(gone)).map((p) => p.key).concat(key), key) : null;
    setFocused((f) => (f === key ? (next ?? focusIn(rest, activeDir, f)) : f));
  };

  // TERM-045: every close (keyboard, a tab's x, the pane header) asks first when a program would
  // stop; a tab's panes are checked together so a split tab asks once. Idle, switched off, or a
  // failed check: the tab closes at once.
  const closeTab = async (keys: number[]) => {
    const first = panes.find((p) => p.key === keys[0]);
    const ids = keys.map((k) => ptys.current[k]).filter((id): id is number => id !== undefined);
    const busy = asksBeforeClose(settings) ? await busyCount(ids, (ids) => invoke<boolean[]>("terminal_busy", { ids })) : 0;
    if (busy === 0 || !first) return keys.forEach(dropPane);
    setAsking({ keys, ...closeQuestion(tabName(first, titles), busy, keys.length) });
  };
  const closePane = (key: number) => void closeTab([key]);

  // SKILL-009 / SKILL-010: the shown workspace's kit run and its seats.
  const [kitCheck] = useKitCheck(activeDir, kitFolded, kitTick);
  const kitSeats = kitCheck && activeDir !== null
    ? matchSeats(
        kitCheck.record,
        kitRuns.current[activeDir]?.started === kitCheck.record.started ? kitRuns.current[activeDir].seats : null,
        panesIn(panes, activeDir).filter((p) => !p.kind).map((p) => ({ key: p.key, ai: aiOf(p) })),
      )
    : [];
  const terminals = screen === "terminals";
  const board = screen === "board";
  const live = panes.filter((p) => running[p.key]);
  const openDirs = panes.map((p) => p.cwd).filter((d): d is string => d !== null);
  // PROJ-063 / PROJ-050: a workspace row shows the strongest state among its panes, and remembers
  // when that last moved so the smart sort can put the newest change first.
  const byDir: Record<string, AgentState[]> = {};
  for (const p of panes) if (p.cwd !== null && p.kind !== "browser" && !p.seats) (byDir[p.cwd] ??= []).push(paneState(p.agent, running[p.key]));
  const rowStates: Record<string, RowInfo> = {};
  for (const [dir, states] of Object.entries(byDir)) {
    const state = strongest(states);
    const prev = rowRef.current[dir];
    rowStates[dir] = prev && prev.state === state ? prev : { state, changed: Date.now(), pr: null };
  }
  rowRef.current = rowStates;
  const cells = cellsOf(panes);
  const shown = cells.filter((c) => sameDir(c.panes[0].cwd, activeDir));
  const activeOf = (c: (typeof cells)[number]) => (c.panes.some((p) => p.key === activeTab[c.group]) ? activeTab[c.group] : c.panes[c.panes.length - 1].key);
  // TERM-118: a pane is in view when its workspace is in front and it is the tab on top (the Board
  // shows every pane); a finish or bell anywhere else marks tab, pane and workspace row unread
  // and says so in the window. A desktop notification and the settings that gate it are T-026.
  const inView = (key: number) => {
    const cell = cells.find((c) => c.panes.some((p) => p.key === key));
    if (!cell) return false;
    return board || (terminals && sameDir(cell.panes[0].cwd, activeDir) && activeOf(cell) === key);
  };
  const noticed = (p: Pane, what: string) => {
    if (!marksUnread(p.key, new Set(panes.map((x) => x.key)), unreadPanes, inView(p.key), winFocused)) return;
    setUnreadPanes((u) => new Set([...u, p.key]));
    if (p.cwd !== null) markDir(p.cwd, true);
    setToast(`${tabName(p, titles)} ${what}`);
  };
  useEffect(() => {
    // Viewing a marked pane in a focused window clears its mark.
    if (!winFocused || unreadPanes.size === 0) return;
    const seen = [...unreadPanes].filter(inView);
    if (seen.length === 0) return;
    setUnreadPanes((u) => new Set([...u].filter((k) => !seen.includes(k))));
    for (const p of panes) if (seen.includes(p.key) && p.cwd !== null) markDir(p.cwd, false);
  });
  return (
    <div className="app">
      <TopBar screen={screen} classic={classic} onScreen={setScreen} onSettings={() => setSettingsOpen(true)} sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((o) => !o)} onSearch={() => setPalette(true)} onBack={travel(hist, -1, stillThere) === null ? undefined : () => step(-1)} onForward={travel(hist, 1, stillThere) === null ? undefined : () => step(1)} rightOpen={terminals && (scmOpen || explorerOpen)} onToggleRight={() => { if (terminals && (scmOpen || explorerOpen)) { setScmOpen(false); setExplorerOpen(false); } else { setScreen("terminals"); setScmOpen(true); } }} />
      <div className="body">
        {palette && (
          <WorktreePalette
            projects={projects}
            items={paletteItems()}
            prOf={(d) => Object.entries(rowStates).find(([x]) => sameDir(x, d))?.[1].pr ?? null}
            onWorktree={(w) => {
              setScreen("terminals");
              select(w.path, w.branch ?? null);
            }}
            onCreate={(name) => {
              setScreen("terminals");
              setSidebarOpen(true);
              setCreateName(name);
              setCreateRequest((n) => n + 1);
            }}
            onClose={() => setPalette(false)}
          />
        )}
        {asking && (
          <CloseAsk
            title={asking.title}
            body={asking.body}
            onCancel={() => setAsking(null)}
            onConfirm={() => {
              asking.keys.forEach(dropPane);
              setAsking(null);
            }}
          />
        )}
        {settingsOpen && <SettingsPage onClose={() => setSettingsOpen(false)} target={settingsAt.target} n={settingsAt.n} />}
        {(terminals || screen === "artifacts") && sidebarOpen && (
          <ProjectsPanel
            openDirs={openDirs}
            states={rowStates}
            unread={unreadDirs}
            onUnread={markDir}
            settings={settings}
            onSetting={saveSetting}
            activeDir={activeDir}
            onSelect={select}
            onRemoved={removed}
            nest={settings[NESTING_KEY] !== false}
            onNest={(on) => {
              const next = { ...settings, [NESTING_KEY]: on };
              setSettings(next);
              invoke("save_settings", { value: next }).catch((err) => setNotice(String(err)));
            }}
            agents={agents}
            defaultId={defaultId}
            onSetDefault={setDefault}
            launching={launching}
            onLaunch={launch}
            onChoose={addChooser}
            allOff={allSwitchedOff(allAgents, settings)}
            pass={agentPass}
            onRefresh={refreshAgents}
            page={page}
            onPage={(next) => setPage((p) => (p === next ? null : next))}
            refresh={refresh}
            createRequest={createRequest}
            createName={createName}
            deleteRequest={deleteRequest}
            onStartIn={startIn}
            artifactsOn={screen === "artifacts"}
            onArtifacts={() => setScreen("artifacts")}
            onIndex={(list, dirs) => {
              setProjects(list);
              setOwner(dirs);
            }}
          />
        )}
        <div className="content">
          <SignInNotice />
          {terminals && page === "automations" && (
            <AutomationsPage
              projects={projects}
              agents={agents}
              settings={settings}
              onSettings={(next) => {
                setSettings(next);
                invoke("save_settings", { value: next }).catch((err) => setNotice(String(err)));
              }}
            />
          )}
          {terminals && page === "routing" && (
            <RoutingPage
              agents={agents}
              settings={settings}
              onSettings={(next) => {
                setSettings(next);
                invoke("save_settings", { value: next }).catch((err) => setNotice(String(err)));
              }}
            />
          )}
          {terminals && (
            <>
              {page === null && activeDir && kitCheck && (
                <KitStrip
                  check={kitCheck}
                  seats={kitSeats.map((k) => (k === null ? null : { key: k, running: running[k], needs: needs[k] }))}
                  sent={kitRuns.current[activeDir]?.sent ?? {}}
                  now={Date.now()}
                  folded={kitFolded}
                  onFold={setKitFolded}
                  onOpen={() => invoke("kit_open_results", { dir: activeDir }).catch((err) => setToast(`Kolux could not open the results folder: ${String(err)}`))}
                  onFocusSeat={(key) => {
                    setActiveDir(activeDir);
                    setFocused(key);
                  }}
                />
              )}
              {page === null && <LayoutStrip count={shown.length} onLayout={setCount} agents={agents.filter((a) => a.installed)} shells={shells} onNewTab={(a) => void newTab(a)} />}
              {picking === "file" && activeDir && (
                <FilePicker
                  root={activeDir}
                  what="file"
                  load={() => invoke<{ files: string[]; capped: boolean; source: string; rgMissing: boolean }>("file_list", { root: activeDir }).then((l) => quickOpenList(activeDir, l))}
                  onPick={(f) => openFile(f.path)}
                  onClose={() => setPicking(null)}
                />
              )}
              {picking === "markdown" && activeDir && (
                <FilePicker
                  root={activeDir}
                  what="markdown file"
                  load={() => invoke<{ files: string[]; capped: boolean }>("md_list", { root: activeDir }).then((n) => ({ items: n.files.map((path) => ({ path })), capped: n.capped }))}
                  onPick={(f) => openFile(f.path)}
                  onClose={() => setPicking(null)}
                />
              )}
              {picking === "change" && activeDir && (
                <FilePicker
                  root={activeDir}
                  what="changed file"
                  load={() => invoke<{ path: string; staged: boolean; code: string }[]>("git_changes", { root: activeDir }).then((cs) => ({ items: cs.map((c): Pick => ({ path: c.path, staged: c.staged, tag: c.staged ? "Staged" : c.code === "?" ? "Untracked" : "Unstaged" })), capped: false }))}
                  onPick={(f) => openDiff(f.path, !!f.staged)}
                  onClose={() => setPicking(null)}
                />
              )}
              {toast && (
                <div className="toast" role="status">
                  {toast}
                </div>
              )}
              {notice && (
                <div className="notice" role="alert">
                  {notice}
                  {notice === keymapNotice && (
                    <button className="btn link" onClick={() => openSettings("shortcuts", "shortcuts-file")}>
                      Shortcuts settings
                    </button>
                  )}
                  <button className="ib" onClick={() => setNotice(null)} title="Dismiss">
                    ×
                  </button>
                </div>
              )}
            </>
          )}
          {screen === "artifacts" && (
            <>
              <ArtifactsPage onToast={setToast} />
              {toast && (
                <div className="toast" role="status">
                  {toast}
                </div>
              )}
            </>
          )}
          {!terminals && !board && screen !== "artifacts" && (
            <div className="empty">
              <h2>{screens.find((s) => s.id === screen)?.label}</h2>
              <p>Nothing here yet. This screen is built in a later task.</p>
            </div>
          )}
          {board && panes.length === 0 && (
            <div className="empty">
              <h2>Board</h2>
              <p>No session yet.</p>
            </div>
          )}
          <div
            className={board ? "board" : "grid"}
            hidden={(!terminals && !board) || (terminals && page !== null)}
            style={terminals ? { gridTemplateColumns: `repeat(${columnsFor(shown.length)}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rowsFor(shown.length)}, minmax(0, 1fr))` } : undefined}
          >
              {terminals && shown.length === 0 && (
                <div className="empty">
                  <h2>{activeDir ? folderName(activeDir) : "Terminal"}</h2>
                  <p>No terminal open here.</p>
                  <div className="btn-row">
                    <button className="btn" onClick={() => addShell(activeDir, null)}>
                      Open a shell
                    </button>
                    <button className="btn" onClick={addChooser}>
                      Choose what to run
                    </button>
                  </div>
                </div>
              )}
              {cells.map((c) => {
                const active = activeOf(c);
                return (
                  <div key={c.group} className="cell" hidden={!board && !sameDir(c.panes[0].cwd, activeDir)}>
                    {c.panes.length > 1 && (
                      <div className="tabs" role="tablist" aria-label="Tabs">
                        {c.panes.map((p) => (
                          <div key={p.key} role="tab" aria-selected={p.key === active} className="tab" tabIndex={0} onMouseDown={() => setFocused(p.key)}>
                            {p.kind === "editor" || p.kind === "preview" || p.kind === "diff" || p.kind === "changes" ? <FileCode size={12} /> : <VendorMark agent={p.agent} size={12} />}
                            {!p.kind && !p.seats && <TabBadge kind={tabBadge(p.agent, running[p.key], needs[p.key] ?? false, unreadPanes.has(p.key))} />}
                            <span className="tab-name">{tabName(p, titles)}</span>
                            {dirty[p.key] && <span className="unsaved" title="Unsaved changes" aria-label="Unsaved changes" />}
                            <button className="tab-x" aria-label={`Close ${tabName(p, titles)}`} onMouseDown={(e) => e.stopPropagation()} onClick={() => closePane(p.key)}>
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {c.panes.map((p) =>
                p.kind === "browser" ? (
                  <BrowserPane key={p.key} id={p.key} title={titles[p.key]} hidden={!terminals || settingsOpen || p.key !== active} focused={p.key === focused} onFocus={() => setFocused(p.key)} onClose={() => closePane(p.key)} />
                ) : p.kind === "editor" && p.path ? (
                  <EditorPane
                    key={p.key}
                    id={p.key}
                    path={p.path}
                    hidden={!terminals || p.key !== active}
                    focused={p.key === focused}
                    onFocus={() => setFocused(p.key)}
                    onClose={() => closePane(p.key)}
                    onDirty={(d) => setDirty((m) => (!!m[p.key] === d ? m : { ...m, [p.key]: d }))}
                    onToast={setToast}
                  />
                ) : p.kind === "diff" && p.path ? (
                  <DiffPane
                    key={p.key}
                    id={p.key}
                    path={p.path}
                    staged={!!p.staged}
                    hidden={!terminals || p.key !== active}
                    focused={p.key === focused}
                    onFocus={() => setFocused(p.key)}
                    onClose={() => closePane(p.key)}
                    onDirty={(d) => setDirty((m) => (!!m[p.key] === d ? m : { ...m, [p.key]: d }))}
                    onToast={setToast}
                  />
                ) : p.kind === "changes" && p.cwd ? (
                  <AllChangesPane key={p.key} id={p.key} root={p.cwd} hidden={!terminals || p.key !== active} focused={p.key === focused} onFocus={() => setFocused(p.key)} onClose={() => closePane(p.key)} />
                ) : p.kind === "preview" && p.path ? (
                  <PreviewPane key={p.key} id={p.key} path={p.path} hidden={!terminals || p.key !== active} focused={p.key === focused} onFocus={() => setFocused(p.key)} onClose={() => closePane(p.key)} />
                ) : p.seats ? (
                  <ChooserPane
                    key={p.key}
                    number={p.key}
                    hidden={!board && p.key !== active}
                    focused={p.key === focused}
                    onFocus={() => setFocused(p.key)}
                    agents={agents.filter((a) => a.installed)}
                    seats={p.seats}
                    pass={agentPass}
                    onRefresh={refreshAgents}
                    lastLineup={offeredLineup(lineupsOf(settings)[projectOf(p.cwd) ?? projectFor(null) ?? ""], installedIds)}
                    onUseLineup={() => {
                      const l = offeredLineup(lineupsOf(settings)[projectOf(p.cwd) ?? projectFor(null) ?? ""], installedIds);
                      if (l) setChooser(p.key, { ...applyLineup(l, installedIds), copies: l.copies });
                    }}
                    onSeats={(s) => setSeats(p.key, s)}
                    shape={p.shape ?? "custom"}
                    onLineup={(shape, s) => setChooser(p.key, { shape, seats: s })}
                    task={p.task ?? ""}
                    onTask={(task) => setChooser(p.key, { task })}
                    onStart={(s) => void startSeats(p.key, s)}
                    copies={p.copies ?? defaultCopies(p.seats.length, inGitFor(p))}
                    inGit={inGitFor(p)}
                    onCopies={(c) => setPanes((ps) => ps.map((x) => (x.key === p.key ? { ...x, copies: c } : x)))}
                    busy={launching}
                    closable
                    onClose={() => closePane(p.key)}
                  />
                ) : (
                  <TerminalPane
                    key={p.key}
                    hidden={!board && p.key !== active}
                    card={board ? { expanded: expanded === p.key, onToggle: () => setExpanded((x) => toggleCard(x, p.key)) } : undefined}
                    cwd={p.cwd}
                    branch={p.branch}
                    agent={p.agent}
                    program={p.program}
                    args={p.args}
                    env={p.env}
                    focused={p.key === focused}
                    onFocus={() => setFocused(p.key)}
                    onRunning={(on) => {
                      if (runRef.current[p.key] && !on && p.agent !== "shell") noticed(p, "finished");
                      setRunning((r) => (r[p.key] === on ? r : { ...r, [p.key]: on }));
                    }}
                    onNeedsYou={(on) => setNeeds((r) => (r[p.key] === on ? r : { ...r, [p.key]: on }))}
                    onBell={() => noticed(p, "rang the bell")}
                    unread={unreadPanes.has(p.key)}
                    onPty={(id) => {
                      ptys.current[p.key] = id;
                      if (p.batch !== undefined && p.agent !== "shell") rememberLineup(p.batch);
                    }}
                    onFailed={(error) => failedPane(p.key, error)}
                    onSplit={() => splitPane(p.key, "right")}
                    title={p.title}
                    typed={p.typed}
                    shellName={p.word}
                    number={p.key}
                    onClose={() => closePane(p.key)}
                    agents={agents}
                    defaultId={defaultId}
                    onSetDefault={setDefault}
                    launching={launching}
                    onLaunch={(a) => launch(a, null)}
                    onChoose={addChooser}
                  />
                ),
              )}
                </div>
              );
            })}
          </div>
        </div>
        {terminals && scmOpen && (
          <SourceControlPanel dir={activeDir} draft={activeDir === null ? "" : (drafts[activeDir] ?? "")} onDraft={(text) => activeDir !== null && setDrafts((d) => ({ ...d, [activeDir]: text }))} onClose={() => setScmOpen(false)} onFix={fixWithAI} pinnedBase={projects.find((p) => p.id === projectOf(activeDir))?.base ?? null} againstUpstream={settings[SUMMARY_UPSTREAM_KEY] === true} onAgainstUpstream={(on) => saveSetting(SUMMARY_UPSTREAM_KEY, on)} agents={menuAgents(agents, defaultId)} onHand={(a, note) => activeDir !== null && void startIn(a, activeDir, panesIn(panes, activeDir)[0]?.branch ?? null, note, true)} />
        )}
        {activeDir && <Explorer key={activeDir} root={activeDir} hidden={!terminals || !explorerOpen} focusAsk={explorerFocus} onOpen={openFile} onClose={() => setExplorerOpen(false)} />}
      </div>
      {kits && kits.kit === null && <KitGallery connected={kitAIs} onPick={pickKit} onClose={() => setKits(null)} />}
      {kits && kits.kit !== null && (() => {
        const kit = KITS.find((k) => k.id === kits.kit)!;
        return (
          <KitSetup
            key={kit.id}
            kit={kit}
            connected={kitAIs}
            dir={activeDir}
            sampleDir={kits.sampleDir}
            settings={settings}
            samplesBusy={samplesBusy}
            onSamples={() => trySamples(kit.id)}
            conflict={kitConflict}
            onBack={() => {
              setKitConflict(null);
              setKits({ kit: null, sampleDir: null });
            }}
            onClose={() => {
              setKitConflict(null);
              setKits(null);
            }}
            onStart={(values, assigned) => {
              // SKILL-005: real inputs are remembered for this workspace; a sample workspace's are not.
              const real = !!activeDir && !sameDir(activeDir, kits.sampleDir);
              if (real) saveSetting(RECALL_KEY, remember(settings, activeDir!, kit, values)[RECALL_KEY]);
              if (activeDir) void startKit(kit, values, assigned, activeDir);
            }}
          />
        );
      })()}
      <UpdateCenter />
      <StatusBar
        terminals={live.length}
        agents={live.filter((p) => p.agent !== "shell").length}
        names={() => Object.fromEntries(panes.flatMap((p) => (ptys.current[p.key] === undefined ? [] : [[ptys.current[p.key], tabName(p, titles)]])))}
        workspaces={Object.keys(owner)}
      />
    </div>
  );
}
