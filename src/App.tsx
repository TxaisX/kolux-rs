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
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { windowTitle, type AppInfo } from "./app-info";
import TopBar, { screens, type Screen } from "./chrome/TopBar";
import SettingsPage from "./settings/SettingsPage";
import CloseAsk from "./terminal/CloseAsk";
import { asksBeforeClose, busyCount, closeQuestion } from "./terminal/closing";
import { closeSet, returnTab, type Which } from "./terminal/tabClose";
import { applyAppearance, readAppearance } from "./theme";
import SignInNotice from "./settings/SignInNotice";
import { OPEN_PAGE_FIELD, openPageAt, readLook, startScreen, titleBarButton } from "./settings/general";
import { OPEN_SETTINGS, openSettings, type SettingsTarget } from "./settings/pages";
import LayoutStrip, { type NewTab } from "./chrome/LayoutStrip";
import BrowserPane from "./browser/BrowserPane";
import EditorPane, { editors } from "./editor/EditorPane";
import { baseName, keyOf } from "./editor/buffers";
import PreviewPane from "./editor/PreviewPane";
import FilePicker, { quickOpenList, type Pick } from "./editor/FilePicker";
import ArtifactsPage from "./artifacts/ArtifactsPage";
import DiffPane, { diffNav } from "./editor/DiffPane";
import AllChangesPane from "./editor/AllChangesPane";
import Explorer from "./editor/Explorer";
import { isMarkdown } from "./editor/markdown";
import { open } from "@tauri-apps/plugin-dialog";
import { cellsOf, columnsFor, groupOf, insertBefore, MAX_PANES, resizePlan, rowsFor, splitIndex, toggleCard, blocking } from "./terminal/grid";
import { gpuOn } from "./terminal/renderer";
import { DIVIDER_DONE, DRAG_ATTR, dragWeights, gapAt, templateOf, tracks, type Gap } from "./terminal/dividers";
import StatusBar from "./chrome/StatusBar";
import { FileCode } from "./chrome/icons";
import AgentsRail from "./agents/AgentsRail";
import { cardPanes, pickSession, railGroups, rowStatus } from "./agents/rail";
import UpdateCenter from "./update/UpdateCenter";
import { FIELDS as STATUS_FIELDS, readStatusBar, toggleItem } from "./chrome/statusItems";
import { chromeShown } from "./chrome/chromeItems";
import VendorMark, { type Agent } from "./chrome/VendorMark";
import TerminalPane, { type PaneNotice } from "./terminal/TerminalPane";
import { accountLabel, accountPrompt, type CodexAccount } from "./terminal/accountChange";
import ProjectsPanel, { type Page } from "./projects/ProjectsPanel";
import AutomationsPage from "./automations/AutomationsPage";
import RoutingPage from "./settings/RoutingPage";
import SourceControlPanel from "./scm/SourceControlPanel";
import { SCM_AGENT_KEY, SUMMARY_UPSTREAM_KEY } from "./scm/model";
import { markFor, programWord, type AgentInfo } from "./launch/PlusMenu";
import { DEFAULT_AGENT_KEY, defaultAgentId, menuAgents, offeredAgents } from "./launch/agents";
import { paneState, strongest, type AgentState, type RowInfo } from "./projects/rows";
import { VOCAB, nextNeedsYou, type Crew } from "./terminal/status";
import { noteTitle, turnNote, type StopInfo, type Turn } from "./terminal/notify";
import { FINISH_FIELD, STOPPED_FIELD } from "./settings/NotificationSwitches";
import { marksUnread, tabBadge, type Badge } from "./terminal/tabs";
import { Bell, Globe, StatusGlyph } from "./chrome/icons";
import Tip from "./chrome/Tip";
import InboxView from "./inbox/InboxView";
import { inboxItems, type Source } from "./inbox/inbox";
import { LANES, chipOf } from "./board/chip";
import Ring from "./usage/Ring";
import { capOn, contextFill, meterOf, meterText, planOf, readsLeft, usageLine, type ContextReading } from "./usage/meter";
import { usePlan } from "./usage/plan";
import ChooserPane from "./launch/ChooserPane";
import { clearMissing, defaultCopies, emptySeat, modelArgs, openingPrompt, restoreShape, rulesBlock, SAVED_SHAPES_KEY, TERMINAL, withoutFailed, type Copies, type SavedShape, type Seat, type Shape } from "./launch/seats";
import { folderName, NESTING_KEY, type CliWorkspace, type Project, type Worktree } from "./projects/model";
import { activeAfterRemove, focusIn, panesIn, sameDir, withoutDir, nameOf } from "./workspaces";
import { LAYOUT_FIELD, layoutOf, type SavedLayout } from "./terminal/layout";
import { Kbd, KeymapProvider, useKeymap } from "./keys/KeymapContext";
import { recording } from "./keys/record";
import { matchEvent } from "./keys/keymap";
import { useUsageAlerts } from "./usage/alerts";

export type ShellTarget = { dir: string | null; branch: string | null };

/** A pane with `seats` is a chooser (SESS-007): nothing runs in it until Start. */
type Pane = { key: number; cwd: string | null; branch: string | null; agent: Agent; agentId?: string; program: string | null; args: string[]; session?: string; env?: [string, string][]; account?: string | null; seats?: Seat[]; copies?: Copies; shape?: Shape; task?: string; title?: string; batch?: number; typed?: string; group?: number; kind?: "browser" | "editor" | "preview" | "diff" | "changes"; path?: string; staged?: boolean };

/** What a tab is called: the seat's title, the agent, the browser page's title, or "Terminal N". */
function tabName(p: Pane, titles: Record<number, string>): string {
  if (p.kind === "browser") return titles[p.key] || "New Tab";
  if (p.kind === "editor") return baseName(p.path ?? "");
  if (p.kind === "preview") return `Preview ${baseName(p.path ?? "")}`;
  if (p.kind === "changes") return "All Changes";
  if (p.kind === "diff") return `${baseName(p.path ?? "")} (${p.staged ? "staged" : "unstaged"})`;
  return p.title || (p.agent !== "shell" ? programWord(p.agent) : `Terminal ${p.key}`);
}
/** TERM-055: the one badge a tab carries beside its agent icon; its look and hover text come from the vocabulary (STAT-052). */
function TabBadge({ kind }: { kind: Badge }) {
  if (!kind) return null;
  if (kind === "unread")
    return (
      <span className="badge unread" role="img" aria-label="unread" data-tip="Finished or rang the bell while you were away.">
        <Bell size={11} />
      </span>
    );
  const v = VOCAB[kind];
  return (
    <span className={`badge ${kind}`} role="img" aria-label={kind === "permission" ? "needs permission" : kind} data-tip={v.explain}>
      <StatusGlyph glyph={v.glyph} size={11} />
    </span>
  );
}
/** SESS-051: a seat's start line as the back end builds it. */
type StartLine = { args: string[]; typed: string | null; program: string | null; env: [string, string][] };

/** Columns for a pane count: 1, side by side for 2, two rows for 3-4, then three across. */
/** `initial`: the settings read before the first frame (main.tsx), so the first screen is right at once. */
export default function App({ initial = {}, layout = null }: { initial?: Record<string, unknown>; layout?: SavedLayout | null }) {
  return (
    <KeymapProvider>
      <Window initial={initial} layout={layout} />
    </KeymapProvider>
  );
}

/** The next screen in the Agents / Board / Terminals cycle. */
export function nextScreen(s: Screen): Screen {
  return screens[(screens.findIndex((x) => x.id === s) + 1) % screens.length].id;
}

function Window({ initial, layout }: { initial: Record<string, unknown>; layout: SavedLayout | null }) {
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
  const [page, setPage] = useState<Page | null>(() => openPageAt(initial)); // VIEW-011: the page open at quit
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
  // PROJ-067: the saved tabs and layout (already checked against the disk by main.tsx) are the starting state.
  const [panes, setPanes] = useState<Pane[]>(() => layout?.panes ?? [{ key: 1, cwd: null, branch: null, agent: "shell", program: null, args: [] }]);
  const [focused, setFocused] = useState(layout?.focused ?? 1);
  // TERM-040: which tab each cell shows; the focused pane's tab comes to the front, and a cell
  // whose active tab was closed falls back to its last tab.
  const [activeTab, setActiveTab] = useState<Record<number, number>>(layout?.activeTab ?? {});
  // VIEW-015: the session picked on the Agents screen, kept across screen switches.
  const [agentSel, setAgentSel] = useState<number | null>(null);
  useEffect(() => {
    const p = panes.find((x) => x.key === focused);
    if (p) setActiveTab((m) => (m[groupOf(p)] === focused ? m : { ...m, [groupOf(p)]: focused }));
  }, [focused, panes]);
  useEffect(() => {
    recentTabs.current = [focused, ...recentTabs.current.filter((k) => k !== focused)].slice(0, 50);
  }, [focused]);
  // The workspace the grid shows; null is the home group (panes opened in no workspace).
  const [activeDir, setActiveDir] = useState<string | null>(layout?.activeDir ?? null);
  const [running, setRunning] = useState<Record<number, boolean>>({});
  // ACCT-064: the managed Codex accounts and the active one, so panes left on another are asked.
  const [codex, setCodex] = useState<{ active: string | null; accounts: CodexAccount[] }>({ active: null, accounts: [] });
  // ACCT-064: per pane, the active account the user chose to keep away from (asked once per change).
  const [kept, setKept] = useState<Record<number, string | null>>({});
  useEffect(() => {
    const read = () => void invoke<{ active: string | null; accounts: CodexAccount[] }>("codex_accounts").then((v) => setCodex({ active: v.active, accounts: v.accounts })).catch(() => {});
    read();
    const off = listen("codex-accounts", read);
    return () => void off.then((u) => u()).catch(() => {});
  }, []);
  const [needs, setNeeds] = useState<Record<number, boolean>>({}); // TERM-030: panes waiting on the user
  const [hook, setHook] = useState<Record<number, AgentState>>({}); // STAT-001: each pane's last hook-fed state
  // STAT-050: when each pane's state last moved, and whether that turn was interrupted; the Inbox's clock.
  const [stamp, setStamp] = useState<Record<number, { at: number; interrupted: boolean }>>({});
  // VIEW-023: what each pane's last event said it was doing, and the newest file it wrote this session.
  const [turn, setTurn] = useState<Record<number, { tool?: string; detail?: string; reply?: string; wrote?: string; stop?: StopInfo }>>({});
  // STAT-045: the terminal has printed nothing for the quiet window; cleared by the next event.
  const [stale, setStale] = useState<Record<number, boolean>>({});
  const [context, setContext] = useState<Record<number, ContextReading>>({}); // STAT-040: each Claude pane's last context reading
  const plan = usePlan(); // USAGE-002: the plan figures the pills read
  const [crew, setCrew] = useState<Record<number, Crew>>({}); // STAT-026: each pane's sub-agents and teammates
  const hookRef = useRef(hook);
  hookRef.current = hook;
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
  const [tabMenu, setTabMenu] = useState<{ key: number; top: number; left: number } | null>(null); // TERM-049: the right-clicked tab
  const recentTabs = useRef<number[]>([]); // TERM-044: panes focused, newest first, so a closed tab returns to the one used before it
  useEffect(() => {
    if (!tabMenu) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && setTabMenu(null);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [tabMenu]);
  const [titles, setTitles] = useState<Record<number, string>>({}); // browser tabs' page titles
  const [allAgents, setAgents] = useState<AgentInfo[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>(initial);
  const [settingsRead, setSettingsRead] = useState(false); // USAGE-009: no alert before this is true
  useUsageAlerts(settingsRead ? settings : null);
  const classic = readLook(settings) === "classic";
  // SET-027: everywhere but Settings, only agents that are switched on are offered.
  const agents = useMemo(() => offeredAgents(allAgents, settings), [allAgents, settings]);
  const [dirty, setDirty] = useState<Record<number, boolean>>({}); // EDIT-001: editor tabs with unsaved text
  const [picking, setPicking] = useState<"file" | "markdown" | "change" | null>(null); // EDIT-036 / EDIT-012 / EDIT-027: which file picker is open
  const defaultId = defaultAgentId(settings);
  const installedIds = agents.filter((a) => a.installed).map((a) => a.id);
  const [projects, setProjects] = useState<Project[]>([]);
  const [owner, setOwner] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({}); // workspace folder -> the name typed for it (PROJ-021)
  const [refresh, setRefresh] = useState(0);
  const [deleteRequest, setDeleteRequest] = useState(0); // PROJ-070: Mod+Shift+Backspace asks to delete the shown workspace
  const recentDirs = useRef<string[]>([]); // PROJ-070: workspaces shown, newest first
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeDir;
  const [createRequest, setCreateRequest] = useState(0); // PROJ-020: Mod+N opens the sidebar's name field
  const [stacked, setStacked] = useState<Record<string, boolean>>(layout?.stacked ?? {}); // TERM-006: a single pane split down makes a stacked pair
  const [weights, setWeights] = useState<Record<string, number[]>>({}); // TERM-010: dragged column / row weights, per folder and pane count
  const dragRef = useRef<{ gap: Gap; at: number; start: number[]; px: number } | null>(null);
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
  const nextKey = useRef(layout ? Math.max(1, ...layout.panes.map((p) => p.key)) + 1 : 2);
  // TERM-106: the tabs that came back from the saved layout replay their saved output first.
  const restoredKeys = useRef(new Set((layout?.panes ?? []).map((p) => p.key)));

  useEffect(() => {
    invoke<AppInfo>("app_info").then(setInfo).catch(() => setInfo(null));
    const readAgents = () => void invoke<AgentInfo[]>("agent_list").then(setAgents).catch(() => setAgents([]));
    readAgents();
    // SET-027: Refresh on the Agents page looks again; the window takes the new list too.
    const offAgents = listen("agents-changed", readAgents);
    // SET-001: the saved look is put on the window every time the settings are read.
    const readSettings = () =>
      void invoke<Record<string, unknown>>("get_settings")
        .then((s) => {
          setSettings(s);
          setSettingsRead(true);
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

  // BROW-003, BROW-005: a browser chord for one tab, pressed in the app or forwarded by the page
  // itself when the keyboard was inside it (T-012-b-fix; the back end's `browser-chord` event).
  const browserAction = (key: number, what: string) => {
    const inBrowser = (sel: string) => document.querySelector<HTMLElement>(`.pane.browser[data-key="${key}"] ${sel}`);
    if (what === "focusAddressBar") {
      const bar = inBrowser(".address") as HTMLInputElement | null;
      bar?.focus();
      bar?.select();
    } else if (what === "reload") void invoke("browser_go", { id: key, what: "reload" });
    else inBrowser(`[data-go="${what}"]`)?.click();
  };
  const chord = useRef(browserAction);
  chord.current = browserAction;
  useEffect(() => {
    // A chord from inside a page also makes that page's split the focused one: a click into the
    // page never reaches the app, so the app may still think another split has the keyboard.
    const un = listen<{ id: number; what: string }>("browser-chord", (e) => {
      setFocused(e.payload.id);
      chord.current(e.payload.id, e.payload.what);
    });
    return () => {
      un.then((u) => u());
    };
  }, []);

  // Global-scope shortcuts are pressed here, wherever focus is (the terminal policy comes with
  // SET-014). Only actions that exist today do something; the rest are matched and left alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // SET-009: while Settings > Shortcuts records a chord, the press is the recorder's alone.
      if (recording.on) return;
      const kind = screen === "terminals" ? panes.find((p) => p.key === focused)?.kind : undefined;
      const inTree = !!document.activeElement?.closest(".explorer"); // the explorer's own keys (EDIT-034) come with T-094-b
      // EDIT-001: in an editor the editor shortcuts come first and terminal ones do not apply;
      // the ones Kolux has no action for yet are left to CodeMirror.
      const hit =
        (kind === "browser" && matchEvent(keymap, e, ["browser"])) ||
        matchEvent(keymap, e, inTree ? ["global"] : kind === "editor" || kind === "diff" ? ["editor", "global", "tabs"] : kind === "preview" ? ["global", "tabs"] : screen === "terminals" ? ["global", "terminal", "tabs"] : ["global"]);
      if (!hit) return;
      const inFront = panesIn(panes, activeDir).some((p) => p.key === focused);
      switch (hit.id) {
        case "browser.focusAddressBar":
        case "browser.back":
        case "browser.forward":
        case "browser.reload":
          browserAction(focused, hit.id.slice("browser.".length));
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
          setCreateRequest((n) => n + 1);
          break;
        case "view.cycleWorkspaceView":
          if (!classic) setScreen((s) => nextScreen(s));
          break;
        case "view.inbox":
          setScreen((s) => (s === "inbox" ? "terminals" : "inbox"));
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
          if (!activeDir) setToast("Open a workspace to pick from its markdown files.");
          else setPicking("markdown");
          break;
        case "tab.newMarkdown":
          if (!activeDir) setToast("Open a workspace to start a markdown note in it.");
          else invoke<string>("md_new", { root: activeDir }).then(openFile, (err) => setToast(String(err)));
          break;
        case "tab.newAgent": {
          // SET-027: with no default (switched off), the first agent available
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
        case "tab.closeAll":
          // TERM-044: every tab of the focused pane's strip, through one close question.
          if (!inFront) return;
          void closeTab(closeSet(orderOf(focused), focused, "all"));
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

  // SESS-007: a pane that asks what to run, in the workspace in front.
  const addChooser = () => {
    const key = nextKey.current++;
    setPanes((ps) => [...ps, { key, cwd: activeDir, branch: null, agent: "shell", program: null, args: [], seats: [emptySeat()] }]);
    setFocused(key);
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
      const pane: Pane = a && line ? { ...base, agent: markFor(a.id), agentId: a.id, program: line.program ?? a.program, args: line.args, env: line.env, typed: line.typed ?? undefined } : { ...base, agent: "shell", program: null, args: [] };
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
  // first and leaves started sessions alone: the ask before removing a started session is
  // TERM-003 on T-151, so until then the toast names the session in the way.
  const setCount = (n: number) => {
    const shown = cellsOf(panesIn(panes, activeDir));
    const cells = shown.map((c) => ({ key: c.group, started: c.panes.some((p) => !p.seats) }));
    const { add, drop } = resizePlan(cells, n);
    const stuck = blocking(cells, n);
    if (stuck.length) {
      const first = shown.find((c) => c.group === stuck[0])?.panes[0];
      setToast(`${first ? tabName(first, titles) : "A pane"} is a started session: close it to go smaller.${stuck.length > 1 ? ` (${stuck.length} in the way.)` : ""}`);
      if (add === 0 && drop.length === 0) return;
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
    // one pane split down becomes a stacked pair; a split right puts the pair side by side again
    const stack = dir === "down" && shown.length === 1;
    setStacked((st) => ({ ...st, [activeDir ?? ""]: stack }));
    const at = splitIndex(shown.map((c) => c.group), groupOf(src), dir, columnsFor(shown.length + 1, stack));
    setPanes(insertBefore(panes, shown[at]?.panes[0], pane));
    setFocused(pane.key);
  };

  const setSeats = (key: number, seats: Seat[]) => setPanes((ps) => ps.map((p) => (p.key === key ? { ...p, seats } : p)));
  const setChooser = (key: number, patch: Partial<Pane>) => setPanes((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));

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
      const lines = await Promise.all(picked.map((a, i) => (a ? invoke<StartLine>("agent_start_line", { id: a.id, extra: modelArgs(seats[i].model), prompt: prompts[i] }) : null)));
      const made: Pane[] = seats.map((s, i) => {
        const a = picked[i];
        const line = lines[i];
        const k = nextKey.current++;
        const title = s.title?.trim() || (s.role && s.role[0].toUpperCase() + s.role.slice(1)) || undefined;
        const { cwd, branch } = places[i];
        return a && line
          ? { key: k, cwd, branch, agent: markFor(a.id), agentId: a.id, program: line.program ?? a.program, args: line.args, env: line.env, title, batch, typed: line.typed ?? undefined }
          : { key: k, cwd, branch, agent: "shell", program: null, args: [], title, batch };
      });
      setPanes((ps) => ps.flatMap((p) => (p.key === key ? made : [p])));
      // VIEW-021: a preset started from the Agents rail stays the selected session once it runs.
      setAgentSel((sel) => (sel === key ? made[0].key : sel));
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
  const startIn = async (agent: AgentInfo, dir: string, branch: string | null, prompt: string, show: boolean, extra: string[] = [], title?: string) => {
    try {
      await openIn(agent, dir, branch, prompt, show, extra, title);
    } catch (err) {
      setNotice(String(err));
    }
  };
  // The start itself; it throws when the start line or the folder's trust cannot be set up, so a
  // caller that reports its own failure (VIEW-069) can say what did not start.
  const openIn = async (agent: AgentInfo, dir: string, branch: string | null, prompt: string, show: boolean, extra: string[] = [], title?: string) => {
    await pretrust(agent.id, [dir]);
    const line = await invoke<StartLine>("agent_start_line", { id: agent.id, extra, prompt });
    const key = nextKey.current++;
    setPanes((ps) => [...ps, { key, cwd: dir, branch, agent: markFor(agent.id), agentId: agent.id, program: line.program ?? agent.program, args: line.args, env: line.env, title, typed: line.typed ?? undefined }]);
    if (show) {
      setActiveDir(dir);
      setFocused(key);
    }
  };
  // VIEW-011: the open page is written down, so it is shown again after a restart.
  useEffect(() => {
    if ((settings[OPEN_PAGE_FIELD] ?? null) !== page) saveSetting(OPEN_PAGE_FIELD, page);
  }, [page]);
  // PROJ-067: the tabs and layout are written down as they change, so they come back after a restart.
  useEffect(() => {
    const l = layoutOf(panes, activeTab, focused, activeDir, stacked);
    if (JSON.stringify(settings[LAYOUT_FIELD] ?? null) !== JSON.stringify(l)) saveSetting(LAYOUT_FIELD, l);
  }, [panes, activeTab, focused, activeDir, stacked]);

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
      setPanes((ps) => [...ps, { key, cwd: wt.path, branch: wt.branch, agent: markFor(agent.id), agentId: agent.id, program: agent.program, args: agent.args }]);
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

  // ACCT-064: Restart starts the program again in the same slot (a new key remounts the pane, which
  // ends the old program) on the account active now; a split beside it is not touched.
  const restartPane = (key: number) => {
    const fresh = nextKey.current++;
    delete ptys.current[key];
    setPanes((ps) => ps.map((p) => (p.key === key ? { ...p, key: fresh, account: undefined, typed: undefined } : p)));
    setRunning((r) => {
      const { [key]: _gone, ...rest } = r;
      return rest;
    });
    setFocused((f) => (f === key ? fresh : f));
  };
  const noticeFor = (p: Pane): PaneNotice | null => {
    const prompt = accountPrompt(p, !!running[p.key], codex.active, codex.accounts, kept[p.key]);
    if (!prompt) return null;
    if (prompt.kind === "removed")
      return prompt.to === null
        ? { title: "This pane's Codex account was removed", body: "Add or pick a Codex account in Settings, then restart this pane.", primary: "Open Settings", onPrimary: () => openSettings("accounts", "codex") }
        : { title: "This pane's Codex account was removed", body: `Restart to run Codex as ${prompt.to}.`, primary: "Restart", onPrimary: () => restartPane(p.key) };
    return {
      title: "The Codex account changed",
      body: `This pane still runs as ${prompt.from}. Restart to run as ${prompt.to}, or keep ${prompt.from} here.`,
      primary: "Restart",
      onPrimary: () => restartPane(p.key),
      secondary: `Keep ${accountLabel(p.account ?? null, codex.accounts)}`,
      onSecondary: () => setKept((k) => ({ ...k, [p.key]: codex.active })),
    };
  };

  /** TERM-044: the tab strip's order for the cell holding pane `key`. */
  const orderOf = (key: number) => {
    const p = panes.find((x) => x.key === key);
    return p ? panes.filter((x) => groupOf(x) === groupOf(p)).map((x) => x.key) : [];
  };
  // TERM-044: the closed tabs leave together; focus returns to the tab used before the active one,
  // else its right neighbour (left if it was last), never to a tab that is closing.
  const dropPanes = (keys: number[]) => {
    const gone = new Set(keys);
    keys.forEach((k) => delete ptys.current[k]);
    // TERM-106: a tab closed on purpose is not brought back after a restart.
    keys.forEach((k) => void invoke("terminal_forget_history", { paneKey: k }).catch(() => {}));
    setPanes((ps) => ps.filter((p) => !gone.has(p.key)));
    setRunning((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !gone.has(Number(k)))));
    setDirty((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !gone.has(Number(k)))));
    const rest = panes.filter((p) => !gone.has(p.key));
    setFocused((f) => {
      if (!gone.has(f)) return f;
      const next = returnTab(orderOf(f), [f, ...keys.filter((k) => k !== f)], recentTabs.current);
      return next ?? focusIn(rest, activeDir, f);
    });
  };

  // TERM-045: every close (keyboard, a tab's x, the pane header) asks first when a program would
  // stop; a tab's panes are checked together so a split tab asks once. Idle, switched off, or a
  // failed check: the tab closes at once.
  const closeTab = async (keys: number[]) => {
    const first = panes.find((p) => p.key === keys[0]);
    const ids = keys.map((k) => ptys.current[k]).filter((id): id is number => id !== undefined);
    const busy = asksBeforeClose(settings) ? await busyCount(ids, (ids) => invoke<boolean[]>("terminal_busy", { ids })) : 0;
    if (busy === 0 || !first) return dropPanes(keys);
    setAsking({ keys, ...closeQuestion(tabName(first, titles), busy, keys.length) });
  };
  const closePane = (key: number) => void closeTab([key]);

  const terminals = screen === "terminals";
  const board = screen === "board";
  const inbox = screen === "inbox";
  const agentsScreen = screen === "agents";
  // STAT-050: the Inbox and the Board read the panes the window already tracks; the clock ticks while one is open.
  const [now, setNow] = useState(Date.now());
  const timed = inbox || board;
  useEffect(() => {
    if (!timed) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [timed]);
  const sources: Source[] = panes
    .filter((p) => !p.kind && !p.seats)
    .map((p) => {
      const state = hook[p.key] ?? paneState(p.agent, running[p.key]);
      const m = stamp[p.key];
      return { key: p.key, agent: p.agent, title: tabName(p, titles), branch: p.branch, cwd: p.cwd, state, interrupted: m?.interrupted ?? false, running: running[p.key] !== false, changed: m?.at ?? 0, finishedAt: state === "done" ? (m?.at ?? null) : null };
    });
  const openPane = (key: number) => {
    const p = panes.find((x) => x.key === key);
    if (!p) return;
    setScreen("terminals");
    if (p.cwd) setActiveDir(p.cwd);
    setFocused(key);
  };
  const live = panes.filter((p) => running[p.key]);
  const openDirs = panes.map((p) => p.cwd).filter((d): d is string => d !== null);
  // PROJ-063 / PROJ-050: a workspace row shows the strongest state among its panes, and remembers
  // when that last moved so the smart sort can put the newest change first.
  const byDir: Record<string, AgentState[]> = {};
  // STAT-001: a hook-fed state wins over the guess from the program's state.
  for (const p of panes) if (p.cwd !== null && p.kind !== "browser" && !p.seats) (byDir[p.cwd] ??= []).push(hook[p.key] ?? paneState(p.agent, running[p.key]));
  const rowStates: Record<string, RowInfo> = {};
  for (const [dir, states] of Object.entries(byDir)) {
    const state = strongest(states);
    const prev = rowRef.current[dir];
    rowStates[dir] = prev && prev.state === state ? prev : { state, changed: Date.now(), pr: null };
  }
  rowRef.current = rowStates;
  const cells = cellsOf(panes);
  const shown = cells.filter((c) => sameDir(c.panes[0].cwd, activeDir));
  // TERM-010: the grid's column and row weights, even until a divider is dragged; a drag starts on
  // the grid's own gap, the grid takes the pointer so a release outside the window still ends it,
  // and the end is announced so panes send their program the final size once.
  const gridCols = columnsFor(shown.length, stacked[activeDir ?? ""]);
  const gridRows = rowsFor(shown.length, stacked[activeDir ?? ""]);
  const weightKey = (axis: "col" | "row") => `${activeDir ?? ""}|${axis}|${axis === "col" ? gridCols : gridRows}`;
  const weightsOf = (axis: "col" | "row") => weights[weightKey(axis)] ?? Array<number>(axis === "col" ? gridCols : gridRows).fill(1);
  const gapUnder = (g: HTMLElement, x: number, y: number) => {
    const rects = [...g.querySelectorAll<HTMLElement>(":scope > .cell:not([hidden])")].map((c) => c.getBoundingClientRect());
    const cols = tracks(rects, "x");
    const rows = tracks(rects, "y");
    const gap = gapAt(x, y, cols, rows);
    return gap && { gap, px: (gap.axis === "col" ? cols : rows).reduce((a, t) => a + t.end - t.start, 0) };
  };
  const onDividerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!terminals || e.target !== e.currentTarget || e.button !== 0) return;
    const hit = gapUnder(e.currentTarget, e.clientX, e.clientY);
    if (!hit) return;
    dragRef.current = { gap: hit.gap, at: hit.gap.axis === "col" ? e.clientX : e.clientY, start: weightsOf(hit.gap.axis), px: hit.px };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // a synthetic pointer has nothing to capture
    }
    document.documentElement.setAttribute(DRAG_ATTR, hit.gap.axis);
    e.preventDefault();
  };
  const onDividerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) {
      if (terminals && e.target === e.currentTarget) {
        const hit = gapUnder(e.currentTarget, e.clientX, e.clientY);
        e.currentTarget.style.cursor = hit ? `${hit.gap.axis}-resize` : "";
      }
      return;
    }
    const now = d.gap.axis === "col" ? e.clientX : e.clientY;
    setWeights((w) => ({ ...w, [weightKey(d.gap.axis)]: dragWeights(d.start, d.gap.i, now - d.at, d.px) }));
  };
  const endDividerDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    document.documentElement.removeAttribute(DRAG_ATTR);
    window.dispatchEvent(new Event(DIVIDER_DONE));
  };
  const activeOf = (c: (typeof cells)[number]) => (c.panes.some((p) => p.key === activeTab[c.group]) ? activeTab[c.group] : c.panes[c.panes.length - 1].key);
  // VIEW-015 / VIEW-021: the Agents rail groups sessions under the saved (switched-on, installed)
  // agents; the shown session is the remembered pick, else the first agent's newest; + adds a
  // not-started preset under that agent. VIEW-024: cards carry the saved agent's name.
  const saved = agents.filter((a) => a.installed);
  const groups = railGroups(panes, saved);
  const selected = agentsScreen ? pickSession(groups, agentSel) : agentSel;
  useEffect(() => {
    if (agentsScreen && selected !== agentSel) setAgentSel(selected);
  }, [agentsScreen, selected, agentSel]);
  const savedName = (p: Pane) => saved.find((a) => a.id === p.agentId)?.name;
  // USAGE-004 / VIEW-018: the rail's rings are the tab rings; the footer is the picked session's 5-hour window.
  const ringOf = (p: Pane) => (context[p.key] ? { percent: contextFill(context[p.key], capOn(settings)), title: meterText(meterOf(context[p.key], p.agent, plan.claude, plan.codex, capOn(settings)) ?? {}) } : null);
  const picked = panes.find((p) => p.key === selected);
  const footer = picked ? usageLine(picked.seats ? markFor(picked.agentId ?? "") : picked.agent, plan.claude, plan.codex, readsLeft(settings)) : "";
  const planLine = (p: Pane) => {
    const f = planOf(p.agent, plan.claude, plan.codex);
    return f ? meterText({ plan: f }) : undefined;
  };
  const addPreset = (id: string) => {
    const key = nextKey.current++;
    setPanes((ps) => [...ps, { key, cwd: activeDir, branch: null, agent: "shell", agentId: id, program: null, args: [], seats: [{ agent: id, model: null }] }]);
    setAgentSel(key);
    setFocused(key);
  };
  // VIEW-023: a card's chip and lane; VIEW-025: an answer typed into the agent's own prompt.
  const chipFor = (p: Pane) => chipOf({ agent: p.agent, state: hook[p.key], running: running[p.key], stale: stale[p.key] ?? false, ...turn[p.key], since: stamp[p.key]?.at ?? 0 }, now);
  const laneOf = (p: Pane) => (p.seats || p.kind || p.agent === "shell" ? "idle" : (chipFor(p)?.lane ?? "idle"));
  const lanes = board ? LANES.filter((l) => cardPanes(panes).some((p) => laneOf(p) === l.id)) : [];
  const columnOf = (p: Pane) => lanes.findIndex((l) => l.id === laneOf(p)) + 1;
  const answer = (p: Pane, approve: boolean) =>
    invoke("agent_answer", { paneKey: p.key, agent: p.agent, approve })
      .then(() => {
        setHook((h) => ({ ...h, [p.key]: "working" }));
        setStamp((m) => ({ ...m, [p.key]: { at: Date.now(), interrupted: false } }));
      })
      .catch(() => {});
  // TERM-118: a pane is in view when its workspace is in front and it is the tab on top (the Board
  // shows every pane); a finish or bell anywhere else marks tab, pane and workspace row unread
  // and says so in the window. A desktop notification and the settings that gate it are T-026.
  const inView = (key: number) => {
    const cell = cells.find((c) => c.panes.some((p) => p.key === key));
    if (!cell) return false;
    return board || (terminals && sameDir(cell.panes[0].cwd, activeDir) && activeOf(cell) === key);
  };
  // STAT-041: the note names the repository when more than one has agents running.
  const repoOf = (p: Pane): string | null => {
    const repos = new Set(panes.filter((x) => x.agent !== "shell" && x.cwd !== null).map((x) => folderName(x.cwd as string)));
    return repos.size > 1 && p.cwd !== null ? folderName(p.cwd) : null;
  };
  const noticed = (p: Pane, what: string, body = "", gate: string = FINISH_FIELD) => {
    const known = new Set(panes.map((x) => x.key));
    if (!known.has(p.key)) return;
    const title = noteTitle(tabName(p, titles), repoOf(p), what);
    // STAT-041: every note on a pane out of view (or in an unfocused window) is a desktop
    // notification unless 'Agent Task Complete' is off (a stop goes by 'Agent Stopped', STAT-023);
    // the unread mark and the toast keep T-024's one-mark-until-viewed rule.
    if (!(inView(p.key) && winFocused) && settings[gate] !== false) invoke("notify", { title, body }).catch(() => {});
    if (!marksUnread(p.key, known, unreadPanes, inView(p.key), winFocused)) return;
    setUnreadPanes((u) => new Set([...u, p.key]));
    if (p.cwd !== null) markDir(p.cwd, true);
    setToast(title);
  };
  const noticedRef = useRef(noticed);
  noticedRef.current = noticed;
  // STAT-045: the quiet alert has its own switch (the minutes), so neither the view nor the finish
  // switch gates it: a toast and a desktop notification, once per silent spell.
  const quiet = (p: Pane, minutes: number) => {
    const title = noteTitle(tabName(p, titles), repoOf(p), `has gone quiet for ${minutes} min`);
    setToast(title);
    invoke("notify", { title, body: "No terminal output since then. It may be stuck." }).catch(() => {});
  };
  const quietRef = useRef(quiet);
  quietRef.current = quiet;
  const panesRef = useRef(panes);
  panesRef.current = panes;
  useEffect(() => {
    // STAT-001: the hooks report each pane's state; a turn ending out of view is noticed like an exit.
    const off = listen<{ paneKey: number; children: Crew; tool?: string; detail?: string; wrote?: string; session?: string } & Turn>("agent-status", (e) => {
      const { paneKey, state, children, tool, detail, reply, wrote, boundary, stop, session } = e.payload;
      // SESS-030: the newest session id is what a restart resumes (a /clear or a resume brings a new one).
      if (session) setPanes((ps) => (ps.some((p) => p.key === paneKey && p.session !== session) ? ps.map((p) => (p.key === paneKey ? { ...p, session } : p)) : ps));
      setCrew((c) => (children.length === 0 && !(paneKey in c) ? c : { ...c, [paneKey]: children }));
      setTurn((t) => ({ ...t, [paneKey]: { tool, detail, reply, stop, wrote: boundary ? undefined : (wrote ?? t[paneKey]?.wrote) } }));
      setStale((m) => (m[paneKey] ? { ...m, [paneKey]: false } : m));
      const prev = hookRef.current[paneKey];
      // STAT-041: a finish, a permission request, a block, an interrupt or a sub-agent's turn is a note.
      const note = turnNote(prev, e.payload);
      if (note) {
        const p = panesRef.current.find((x) => x.key === paneKey);
        if (p) noticedRef.current(p, note.what, note.body, note.stopped ? STOPPED_FIELD : FINISH_FIELD);
      }
      // STAT-046: a stop on a sign-in failure has the account checked, so the main-window notice
      // (SignInNotice) names the lapsed account without waiting for the next start.
      if (stop?.cause === "signin" && prev !== "blocked") invoke("claude_account_check").catch(() => {});
      if (prev !== state) {
        setHook((h) => ({ ...h, [paneKey]: state }));
        setStamp((m) => ({ ...m, [paneKey]: { at: Date.now(), interrupted: e.payload.interrupted } }));
      }
    });
    // STAT-045: the quiet alert comes from the terminal's own silence, judged in Rust.
    const offUsage = listen<{ paneKey: number; contextTokens: number | null; contextWindow: number | null }>("claude-usage", (e) => {
      const { paneKey, contextTokens, contextWindow } = e.payload;
      if (contextTokens !== null && contextWindow !== null) setContext((c) => ({ ...c, [paneKey]: { tokens: contextTokens, window: contextWindow } }));
    });
    const offQuiet = listen<{ paneKey: number; minutes: number }>("agent-quiet", (e) => {
      const p = panesRef.current.find((x) => x.key === e.payload.paneKey);
      if (p) quietRef.current(p, e.payload.minutes);
      setStale((m) => ({ ...m, [e.payload.paneKey]: true }));
    });
    return () => {
      off.then((f) => f());
      offQuiet.then((f) => f());
      offUsage.then((f) => f());
    };
  }, []);
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
      <Tip />
      <TopBar
        appName={chromeShown(settings, "titleBarAppName")}
        automations={
          titleBarButton(settings, "automations")
            ? {
                open: terminals && page === "automations",
                onToggle: () => {
                  setScreen("terminals");
                  setPage((p) => (terminals && p === "automations" ? null : "automations"));
                },
              }
            : undefined
        }
        screen={screen}
        classic={classic}
        onScreen={setScreen} installed={installedIds} onSettings={() => setSettingsOpen(true)} sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((o) => !o)} rightOpen={terminals && (scmOpen || explorerOpen)} onToggleRight={() => { if (terminals && (scmOpen || explorerOpen)) { setScmOpen(false); setExplorerOpen(false); } else { setScreen("terminals"); setScmOpen(true); } }} />
      <div className="body">
        {asking && (
          <CloseAsk
            title={asking.title}
            body={asking.body}
            onCancel={() => setAsking(null)}
            onConfirm={() => {
              dropPanes(asking.keys);
              setAsking(null);
            }}
          />
        )}
        {tabMenu && (
          // TERM-049 / TERM-044: close items only; the close question (TERM-045) covers the whole set at once.
          <>
            <div
              className="menu-backdrop"
              aria-hidden="true"
              onClick={() => setTabMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault();
                setTabMenu(null);
              }}
            />
            <div className="menu" role="menu" aria-label="Tab" style={{ top: tabMenu.top, left: tabMenu.left }}>
              {(
                [
                  ["Close", "one"],
                  ["Close others", "others"],
                  ["Close to the right", "right"],
                  ["Close to the left", "left"],
                  ["Close all", "all"],
                ] as [string, Which][]
              ).map(([label, which]) => {
                const keys = closeSet(orderOf(tabMenu.key), tabMenu.key, which);
                return (
                  <button
                    key={which}
                    role="menuitem"
                    className="menu-item"
                    disabled={keys.length === 0}
                    onClick={() => {
                      setTabMenu(null);
                      void closeTab(keys);
                    }}
                  >
                    <span className="name">{label}</span>
                    {which === "one" && <Kbd id="tab.close" />}
                    {which === "all" && <Kbd id="tab.closeAll" />}
                  </button>
                );
              })}
            </div>
          </>
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
            onTerminal={() => void newTab(null)}
            page={page}
            onPage={(next) => setPage((p) => (p === next ? null : next))}
            refresh={refresh}
            createRequest={createRequest}
            deleteRequest={deleteRequest}
            onStartIn={startIn}
            artifactsOn={screen === "artifacts"}
            onArtifacts={() => setScreen("artifacts")}
            onIndex={(list, dirs, typed) => {
              setProjects(list);
              setOwner(dirs);
              setNames(typed);
            }}
          />
        )}
        {agentsScreen && (
          <AgentsRail
            groups={groups}
            selected={selected}
            classic={classic}
            statusOf={(p) => rowStatus(p, chipFor(p))}
            ringOf={ringOf}
            footer={footer}
            onSelect={(key) => {
              setAgentSel(key);
              setFocused(key);
            }}
            onAdd={addPreset}
            onSettings={() => openSettings("agents")}
          />
        )}
        <div className="content">
          <SignInNotice />
          {terminals && page === "automations" && (
            <AutomationsPage
              onClose={() => setPage(null)}
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
              {page === null && <LayoutStrip count={shown.length} onLayout={setCount} agents={agents.filter((a) => a.installed)} onNewTab={(a) => void newTab(a)} />}
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
          {inbox && <InboxView items={inboxItems(sources, now)} now={now} onOpen={openPane} />}
          {agentsScreen && selected === null && (
            <div className="empty">
              <h2>Agents</h2>
              <p>{saved.length ? "No session yet. Add one with + under an agent." : "No agents yet."}</p>
            </div>
          )}
          {board && cardPanes(panes).length === 0 && (
            <div className="empty">
              <h2>Board</h2>
              <p>No session yet.</p>
            </div>
          )}
          <div
            className={board ? "board" : agentsScreen ? "grid agents" : "grid"}
            hidden={(!terminals && !board && !agentsScreen) || (terminals && page !== null) || (agentsScreen && selected === null)}
            onPointerDown={onDividerDown}
            onPointerMove={onDividerMove}
            onPointerUp={endDividerDrag}
            onPointerCancel={endDividerDrag}
            onLostPointerCapture={endDividerDrag}
            style={terminals ? { gridTemplateColumns: templateOf(weightsOf("col")), gridTemplateRows: templateOf(weightsOf("row")) } : board ? { gridTemplateColumns: `repeat(${lanes.length || 1}, minmax(0, 1fr))` } : undefined}
          >
              {board &&
                lanes.map((l, i) => (
                  <h3 key={l.id} className="lane" style={{ gridColumn: i + 1 }}>
                    {l.title}
                  </h3>
                ))}
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
              {/* TERM-017: cells are keyed by group and panes by key, and a split only inserts, so a
                  pane's terminal is never remounted (never respawned) by a layout change. */}
              {cells.map((c) => {
                // VIEW-015: on the Agents screen the picked session is the one shown, whatever tab its cell had in front.
                const mine = agentsScreen && c.panes.some((p) => p.key === selected);
                const active = mine ? (selected as number) : activeOf(c);
                return (
                  <div key={c.group} className="cell" hidden={agentsScreen ? !mine : !board && !sameDir(c.panes[0].cwd, activeDir)}>
                    {c.panes.length > 1 && (
                      <div className="tabs" role="tablist" aria-label="Tabs">
                        {c.panes.map((p) => (
                          <div
                            key={p.key}
                            role="tab"
                            aria-selected={p.key === active}
                            className="tab"
                            tabIndex={0}
                            onMouseDown={() => setFocused(p.key)}
                            onContextMenu={(e) => {
                              // TERM-049: the tab menu opens where the pointer is; this click never closes it.
                              e.preventDefault();
                              e.stopPropagation();
                              setTabMenu({ key: p.key, top: e.clientY, left: e.clientX });
                            }}
                            onAuxClick={(e) => {
                              // TERM-049: middle-click closes the tab (pinned tabs, once they exist, are exempt).
                              if (e.button !== 1) return;
                              e.preventDefault();
                              closePane(p.key);
                            }}
                          >
                            {p.kind === "editor" || p.kind === "preview" || p.kind === "diff" || p.kind === "changes" ? <FileCode size={12} /> : p.kind === "browser" ? <Globe size={12} /> : <VendorMark agent={p.agent} size={12} />}
                            {!p.kind && !p.seats && <TabBadge kind={tabBadge(p.agent, running[p.key], needs[p.key] ?? false, unreadPanes.has(p.key), hook[p.key])} />}
                            {context[p.key] && <Ring percent={contextFill(context[p.key], capOn(settings))} size={10} title={meterText(meterOf(context[p.key], p.agent, plan.claude, plan.codex, capOn(settings)) ?? {})} />}
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
                    seats={clearMissing(p.seats, installedIds)}
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
                    saved={Array.isArray(settings[SAVED_SHAPES_KEY]) ? (settings[SAVED_SHAPES_KEY] as SavedShape[]) : []}
                    onSaved={(list) => saveSetting(SAVED_SHAPES_KEY, list)}
                    onPickSaved={(t) => setChooser(p.key, { shape: "custom", seats: restoreShape(t, installedIds), task: t.task ?? "", copies: t.copies })}
                  />
                ) : (
                  <TerminalPane
                    key={p.key}
                    hidden={!board && p.key !== active}
                    restored={restoredKeys.current.has(p.key)}
                    gpu={gpuOn(settings)}
                    card={board ? { expanded: expanded === p.key, onToggle: () => setExpanded((x) => toggleCard(x, p.key)), chip: chipFor(p), column: columnOf(p), onAnswer: (ok) => void answer(p, ok), meter: p.seats || p.kind ? null : meterOf(context[p.key], p.agent, plan.claude, plan.codex, capOn(settings)) } : undefined}
                    cwd={p.cwd}
                    branch={p.branch}
                    agent={p.agent}
                    name={savedName(p)}
                    plan={agentsScreen ? planLine(p) : undefined}
                    program={p.program}
                    args={p.args}
                    env={p.env}
                    stop={turn[p.key]?.stop}
                    context={context[p.key] && contextFill(context[p.key], capOn(settings))}
                    focused={p.key === focused}
                    onFocus={() => setFocused(p.key)}
                    onRunning={(on) => {
                      if (runRef.current[p.key] && !on && p.agent !== "shell") {
                        noticed(p, "finished");
                        setStamp((m) => ({ ...m, [p.key]: { at: Date.now(), interrupted: false } }));
                      }
                      setRunning((r) => (r[p.key] === on ? r : { ...r, [p.key]: on }));
                      // STAT-050: a pane that just started counts from now in the Inbox.
                      if (on) setStamp((m) => (m[p.key] ? m : { ...m, [p.key]: { at: Date.now(), interrupted: false } }));
                      // The program is gone: its last hook state goes with it.
                      if (!on && p.key in hookRef.current) setHook((h) => Object.fromEntries(Object.entries(h).filter(([k]) => Number(k) !== p.key)));
                    }}
                    hook={hook[p.key]}
                    crew={crew[p.key]}
                    onNeedsYou={(on) => setNeeds((r) => (r[p.key] === on ? r : { ...r, [p.key]: on }))}
                    onBell={() => noticed(p, "rang the bell")}
                    unread={unreadPanes.has(p.key)}
                    onPty={(id, account) => {
                      ptys.current[p.key] = id;
                      // ACCT-023: a Codex pane remembers the account it began on.
                      if (p.agent === "codex" && p.account !== account) setPanes((ps) => ps.map((x) => (x.key === p.key ? { ...x, account } : x)));
                    }}
                    account={p.account}
                    notice={noticeFor(p)}
                    onFailed={(error) => failedPane(p.key, error)}
                    onSplit={() => splitPane(p.key, "right")}
                    title={p.title || nameOf(names, p.cwd)}
                    typed={p.typed}
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
          <SourceControlPanel dir={activeDir} draft={activeDir === null ? "" : (drafts[activeDir] ?? "")} onDraft={(text) => activeDir !== null && setDrafts((d) => ({ ...d, [activeDir]: text }))} onClose={() => setScmOpen(false)} onFix={fixWithAI} pinnedBase={projects.find((p) => p.id === projectOf(activeDir))?.base ?? null} againstUpstream={settings[SUMMARY_UPSTREAM_KEY] === true} onAgainstUpstream={(on) => saveSetting(SUMMARY_UPSTREAM_KEY, on)} fixAgent={settings[SCM_AGENT_KEY]} onFixAgent={(id) => saveSetting(SCM_AGENT_KEY, id)} onAgentAction={async (a, prompt) => {
            if (activeDir === null) return "Open a workspace first.";
            try {
              await openIn(a, activeDir, panesIn(panes, activeDir)[0]?.branch ?? null, prompt, true);
              return null;
            } catch (err) {
              return `${a.name} did not start, so the conflicts were not handed over: ${String(err)}`;
            }
          }} agents={menuAgents(agents, defaultId)} onHand={(a, note) => activeDir !== null && void startIn(a, activeDir, panesIn(panes, activeDir)[0]?.branch ?? null, note, true)} />
        )}
        {activeDir && <Explorer key={activeDir} root={activeDir} hidden={!terminals || !explorerOpen} focusAsk={explorerFocus} onOpen={openFile} onClose={() => setExplorerOpen(false)} />}
      </div>
      <UpdateCenter />
      {readStatusBar(settings).visible && (
      <StatusBar
        hidden={readStatusBar(settings).hidden}
        onToggle={(id) => saveSetting(STATUS_FIELDS.hidden, toggleItem(readStatusBar(settings).hidden, id))}
        onHideBar={() => saveSetting(STATUS_FIELDS.visible, false)}
        terminals={live.length}
        agents={live.filter((p) => p.agent !== "shell").length}
        names={() => Object.fromEntries(panes.flatMap((p) => (ptys.current[p.key] === undefined ? [] : [[ptys.current[p.key], tabName(p, titles)]])))}
        workspaces={Object.keys(owner)}
      />
      )}
    </div>
  );
}
