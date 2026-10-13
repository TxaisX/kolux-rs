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
import { saveChanged } from "./settings/saveChanged";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import { windowTitle, type AppInfo } from "./app-info";
import TopBar, { screens, type Screen } from "./chrome/TopBar";
import SettingsPage from "./settings/SettingsPage";
import Ask from "./chrome/Ask";
import { asksBeforeClose, busyCount, closeQuestion } from "./terminal/closing";
import { applyAppearance, readAppearance } from "./theme";
import SignInNotice from "./settings/SignInNotice";
import KeyLostNotice from "./settings/KeyLostNotice";
import { LAST_SCREEN_FIELD, lastWriter, OPEN_PAGE_FIELD, openPageAt, readLook, startScreen } from "./settings/general";
import { OPEN_SETTINGS, openSettings, type SettingsTarget, PAGES, type PageId } from "./settings/pages";
import WorktreePalette, { type PaletteItem } from "./projects/WorktreePalette";
import { EMPTY_HISTORY, navTarget, travel, visit, type Place } from "./projects/nav";
import LayoutStrip, { type NewTab, type ShellInfo } from "./chrome/LayoutStrip";
import BrowserPane, { OPEN_IN_BROWSER } from "./browser/BrowserPane";
import { writerOf } from "./scm/generate";
import EditorPane, { editors } from "./editor/EditorPane";
import { baseName, keyOf } from "./editor/buffers";
import PreviewPane from "./editor/PreviewPane";
import ReviewNotes from "./editor/ReviewNotes";
import { reviewOn, selections, type Note, type Picked } from "./editor/notes";
import FilePicker, { quickOpenList, type Pick } from "./editor/FilePicker";
import ArtifactsPage from "./artifacts/ArtifactsPage";
import { KitGallery, KitSetup, OPEN_KITS, startValues } from "./kits/Kits";
import Wizard from "./onboarding/Wizard";
import { ADD_PROJECT, closer, firstFolderAgent, kitLaunch, openAt, type Outcome } from "./onboarding/firstRun";
import { KITS, VENDORS, RECALL_KEY, assignRoles, remember, type Kit, type Vendor } from "./kits/catalog";
import KitStrip, { useKitCheck } from "./kits/KitStrip";
import { datedName, matchSeats, previewKind, roleDone, rolePrompt, seatTitle, type Past, type RunCheck } from "./kits/run";
import DiffPane, { diffNav } from "./editor/DiffPane";
import AllChangesPane from "./editor/AllChangesPane";
import Explorer from "./editor/Explorer";
import RightSidebar, { clampWidth, readRight, RIGHT_KEYS, type RightTab } from "./chrome/RightSidebar";
import { isMarkdown } from "./editor/markdown";
import { cellsOf, columnsFor, groupOf, insertBefore, MAX_PANES, neighbourTab, resizePlan, rowsFor, splitIndex, toggleCard, blocking, DEFAULT_PANES_FIELD, freeCell, seedCount, canExpand, toggleZoom, zoomedGroup, type Zoom } from "./terminal/grid";
import StatusBar from "./chrome/StatusBar";
import { FileCode } from "./chrome/icons";
import UpdateCenter from "./update/UpdateCenter";
import { FIELDS as STATUS_FIELDS, readStatusBar, toggleItem } from "./chrome/statusItems";
import { chromeShown } from "./chrome/chromeItems";
import VendorMark, { type Agent } from "./chrome/VendorMark";
import TerminalPane from "./terminal/TerminalPane";
import ProjectsPanel, { type Page } from "./projects/ProjectsPanel";
import AutomationsPage from "./automations/AutomationsPage";
import RoutingPage from "./settings/RoutingPage";
import TasksPage from "./tasks/TasksPage";
import { tasksRepo } from "./tasks/model";
import SourceControlPanel from "./scm/SourceControlPanel";
import { SCM_AGENT_KEY, SCM_GROUP_ORDER_KEY, SCM_LINKED_PR_KEY, SUMMARY_UPSTREAM_KEY, linkedPrs, withLink } from "./scm/model";
import { markFor, programWord, type AgentInfo } from "./launch/PlusMenu";
import { allSwitchedOff, DEFAULT_AGENT_KEY, defaultAgentId, FIRST_PASS, menuAgents, offeredAgents, type AgentPass } from "./launch/agents";
import { paneState, strongest, type AgentState, type RowInfo } from "./projects/rows";
import { VOCAB, nextNeedsYou, type Crew } from "./terminal/status";
import { noteTitle, turnNote, type StopInfo, type Turn } from "./terminal/notify";
import type { KindKey } from "./settings/notifications";
import { marksUnread, tabBadge, type Badge } from "./terminal/tabs";
import { Bell, Globe, StatusGlyph } from "./chrome/icons";
import Tip from "./chrome/Tip";
import InboxView from "./inbox/InboxView";
import { inboxItems, type Source } from "./inbox/inbox";
import { LANES, chipOf } from "./board/chip";
import Ring from "./usage/Ring";
import { capOn, contextFill, meterOf, meterText, type ContextReading } from "./usage/meter";
import { usePlan } from "./usage/plan";
import ChooserPane from "./launch/ChooserPane";
import { clearMissing, defaultCopies, emptySeat, openingPrompt, restoreShape, rulesBlock, SAVED_SHAPES_KEY, TERMINAL, withoutFailed, type Copies, type SavedShape, type Seat, type Shape, applyLineup, LAST_LINEUP_KEY, lineupOf, offeredLineup, removeTarget, seatArgs, sheetStart, type Lineup } from "./launch/seats";
import { folderName, NESTING_KEY, type CliWorkspace, type Project, type Worktree } from "./projects/model";
import { activeAfterRemove, focusIn, panesIn, sameDir, withoutDir, nameOf } from "./workspaces";
import { KeymapProvider, useKeymap } from "./keys/KeymapContext";
import { recording } from "./keys/record";
import { matchEvent } from "./keys/keymap";
import { useUsageAlerts } from "./usage/alerts";
import ToolNotices from "./launch/ToolNotices";

export type ShellTarget = { dir: string | null; branch: string | null };

/** A pane with `seats` is a chooser (SESS-007): nothing runs in it until Start. */
/** SKILL-008: a seat waiting for the role it depends on. */
type KitWait = { role: string; upstream: string; key: number; prompt: string };
/** A kit run started in this window; `prompts` are each role's first message, kept for Restart and Move to (SKILL-011). */
type KitRun = { started: number; seats: (number | null)[] | null; waiting: KitWait[]; sent: Record<string, number>; prompts: string[] };
/** Which kit AI a pane runs, from its mark or, for Grok, its program. */
const aiOf = (p: { agent: string; program: string | null }): string | null => (p.agent === "claude" || p.agent === "codex" ? p.agent : /grok/i.test(p.program ?? "") ? "grok" : null);
type Pane = { key: number; cwd: string | null; branch: string | null; agent: Agent; program: string | null; args: string[]; env?: [string, string][]; seats?: Seat[]; copies?: Copies; shape?: Shape; task?: string; kit?: string | null; title?: string; word?: string; batch?: number; typed?: string; group?: number; kind?: "browser" | "editor" | "preview" | "diff" | "changes"; path?: string; url?: string; kitPreview?: boolean; staged?: boolean; ask?: string };

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
  const [zoom, setZoom] = useState<Zoom>({}); // TERM-013: each workspace's expanded cell
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // DT-17: Automations is a page of its own over the content column, opened from the sidebar;
  // the grid stays mounted (hidden) behind it.
  // SET-028: Model routing opens the same way until Settings > Agents exists.
  const [page, setPage] = useState<Page | null>(() => openPageAt(initial)); // VIEW-011: the page open at quit
  // GIT-004: a half-written commit message per worktree, kept through closing the panel.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // EDIT-033: a bump of explorerFocus moves focus into the explorer's tree.
  const [explorerFocus, setExplorerFocus] = useState(0);
  // VIEW-056: the right sidebar's width while its edge is being dragged; saved when let go.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
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
  const cliFailed = useRef<Record<string, string>>({}); // CLI-026: command-line requests the window could not open
  const [asking, setAsking] = useState<{ keys: number[]; title: string; body: string } | null>(null);
  const [titles, setTitles] = useState<Record<number, string>>({}); // browser tabs' page titles
  const [allAgents, setAgents] = useState<AgentInfo[]>([]);
  const [agentPass, setAgentPass] = useState<AgentPass>(FIRST_PASS); // SESS-002
  const [shells, setShells] = useState<ShellInfo[]>([]); // SESS-006
  const [settings, setSettings] = useState<Record<string, unknown>>(initial);
  const [settingsRead, setSettingsRead] = useState(false); // USAGE-009: no alert before this is true
  useUsageAlerts(settingsRead ? settings : null);
  const classic = readLook(settings) === "classic";
  // SESS-018: on the New look a new session is chosen on a full-page sheet over the workspace,
  // held here rather than in the grid; Classic keeps the chooser pane (SESS-019).
  const [sheet, setSheet] = useState<Pane | null>(null);
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
  const [stacked, setStacked] = useState<Record<string, boolean>>({}); // TERM-006: a single pane split down makes a stacked pair
  const [createName, setCreateName] = useState(""); // PROJ-057: the palette's typed name, prefilled there
  const [palette, setPalette] = useState(false); // PROJ-057 / VIEW-037: the worktree palette is open
  const [hist, setHist] = useState(EMPTY_HISTORY); // VIEW-046: workspaces and pages shown, for back and forward
  const [launching, setLaunching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // A toast is a passing note (SESS-024 "starting 3 sessions"); it clears itself.
  const [toast, setToastText] = useState<string | null>(null);
  // GIT-042: review notes on Markdown, kept until copied or cleared.
  const [notes, setNotes] = useState<Note[]>([]);
  const [picked, setPicked] = useState<Picked | null>(null);
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
  // SKILL-014: the recent kit runs the gallery lists, read each time it opens.
  const [kitRecent, setKitRecent] = useState<Past[]>([]);
  const galleryOpen = kits !== null && kits.kit === null;
  useEffect(() => {
    if (galleryOpen) invoke<Past[]>("kit_history").then(setKitRecent, () => setKitRecent([]));
  }, [galleryOpen]);
  // SESS-019: a chooser's Set up kit names the kit and the chooser, which closes once the kit starts.
  const chooserSetup = useRef<number | null>(null);
  useEffect(() => {
    const show = (e: Event) => {
      const from = (e as CustomEvent<{ kit: string; chooser?: number } | undefined>).detail;
      if (!from) return setKits((k) => k ?? { kit: null, sampleDir: null });
      chooserSetup.current = from.chooser ?? null;
      pickKit(from.kit);
    };
    window.addEventListener(OPEN_KITS, show);
    return () => window.removeEventListener(OPEN_KITS, show);
  }, []);
  // GIT-036: a page asked for in the built-in browser opens as a new tab in the focused split.
  useEffect(() => {
    const show = (e: Event) => {
      const url = (e as CustomEvent<string>).detail;
      const here = panes.find((p) => p.key === focused && sameDir(p.cwd, activeDir));
      const key = nextKey.current++;
      setPanes((ps) => [...ps, { key, cwd: activeDir, branch: here?.branch ?? null, group: here ? groupOf(here) : undefined, agent: "shell", program: null, args: [], kind: "browser", url }]);
      setFocused(key);
    };
    window.addEventListener(OPEN_IN_BROWSER, show);
    return () => window.removeEventListener(OPEN_IN_BROWSER, show);
  }, [panes, focused, activeDir]);
  // SKILL-003: Claude, Codex and Grok, when found and not switched off, can take kit roles.
  const kitAIs = useMemo(() => VENDORS.filter((v) => agents.some((a) => a.id === v && a.installed)), [agents]) as Vendor[];
  const pickKit = (id: string) => {
    setKitConflict(null);
    setKits({ kit: id, sampleDir: null });
    invoke<string>("kit_samples_dir", { kit: id }).then((d) => setKits((k) => (k?.kit === id ? { ...k, sampleDir: d } : k)), () => {});
  };
  // ONB-004 opens a sample the same way, with no launch window (select opens one plain tab).
  const openSamples = async (id: string) => {
    const p = await invoke<{ path: string; name: string }>("kit_samples", { kit: id });
    setRefresh((n) => n + 1);
    select(p.path, null);
  };
  const trySamples = (id: string) => {
    setSamplesBusy(true);
    openSamples(id)
      .catch((err) => setToast(`Kolux could not set up the sample data: ${String(err)}`))
      .finally(() => setSamplesBusy(false));
  };
  const saveSetting = (key: string, value: unknown) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    saveChanged(settings, next).catch((err) => setNotice(String(err)));
  };
  // VIEW-056 / VIEW-057 (T-146-a): one right sidebar, its open state, tab and width kept in settings.
  const right = readRight(settings);
  const explorerOpen = right.open && right.tab === "explorer";
  const scmOpen = right.open && right.tab === "scm";
  const saveRight = (patch: Partial<Record<keyof typeof RIGHT_KEYS, unknown>>) => {
    const next = { ...settings };
    for (const [k, v] of Object.entries(patch)) next[RIGHT_KEYS[k as keyof typeof RIGHT_KEYS]] = v;
    setSettings(next);
    saveChanged(settings, next).catch((err) => setNotice(String(err)));
  };
  const showRight = (tab: RightTab) => {
    setScreen("terminals");
    saveRight({ open: true, tab });
  };
  const toggleExplorer = () => {
    if (explorerOpen && document.activeElement?.closest(".explorer")) return saveRight({ open: false });
    showRight("explorer");
    setExplorerFocus((n) => n + 1);
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
        matchEvent(keymap, e, inTree ? ["global"] : kind === "editor" || kind === "diff" ? ["editor", "global", "tabs"] : kind === "preview" ? ["global", "tabs"] : screen === "terminals" ? ["global", "terminal", "tabs"] : ["global"]) ||
        // GIT-042: a preview tab takes the one editor shortcut that applies to it.
        (kind === "preview" && [matchEvent(keymap, e, ["editor"])].find((h) => h?.id === "editor.addReviewNote"));
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
          if (terminals && scmOpen) saveRight({ open: false });
          else showRight("scm");
          break;
        case "sidebar.right.toggle":
          if (terminals && right.open) saveRight({ open: false });
          else showRight(right.tab);
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
        case "view.tasks":
          setScreen("terminals");
          setPage((p) => (terminals && p === "tasks" ? null : "tasks"));
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
        case "editor.addReviewNote": {
          // With nothing selected, or the review tools off, the shortcut does nothing.
          const got = reviewOn(settings) ? selections.get(focused)?.() : null;
          if (!got) return;
          setPicked(got);
          break;
        }
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
        case "terminal.focusNextPane":
        case "terminal.focusPreviousPane": {
          // TERM-012: the next or previous cell in grid order, wrapping; its tab on top takes focus.
          if (!inFront) return;
          const order = cellsOf(panesIn(panes, activeDir)).map(activeOf);
          const at = cellsOf(panesIn(panes, activeDir)).findIndex((c) => c.panes.some((p) => p.key === focused));
          const t = navTarget(order.length, at, { step: hit.id === "terminal.focusNextPane" ? 1 : -1 });
          if (t === null) return;
          setFocused(order[t]);
          break;
        }
        case "terminal.expandPane":
          if (!inFront) return;
          expandPane(focused);
          break;
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
    if (!classic) {
      // SESS-018: the count and the files choice come from this project's last launch; seats start blank.
      const at: Pane = { key: 0, cwd: activeDir, branch: null, agent: "shell", program: null, args: [] };
      const start = sheetStart(lineupsOf(settings)[projectOf(activeDir) ?? projectFor(null) ?? ""], inGitFor(at));
      setSheet({ ...at, key: nextKey.current++, seats: start.seats, copies: start.copies, shape: "custom" });
      return;
    }
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
      // ACCT-055: Kolux shows the picker itself, so only the chosen file is granted to the window.
      const path = await invoke<string | null>("file_pick", { defaultPath: activeDir }).catch((err) => (setToast(String(err)), null));
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
  // CLI-026: a split from the command line works on the pane named, wherever it is, and leaves the
  // active tab and the focus alone.
  // TERM-013: the pane's cell fills the grid (alone in the clean look, the whole workspace area);
  // again restores every pane to its place. Nothing restarts: the other cells are only hidden.
  const expandPane = (key: number) => {
    const p = panes.find((x) => x.key === key);
    if (!p) return;
    const groups = cellsOf(panesIn(panes, p.cwd)).map((c) => c.group);
    if (canExpand(groups.length, classic)) setZoom((z) => toggleZoom(z, p.cwd ?? "", groupOf(p), groups.length));
  };
  const splitPane = (key: number, dir: "right" | "down", cli?: { ask: string; command: string | null }) => {
    const src = panes.find((p) => p.key === key);
    if (!src) {
      if (cli) cliFailed.current[cli.ask] = "that terminal is not in the window";
      return;
    }
    const shown = cellsOf(panesIn(panes, src.cwd));
    if (shown.length >= MAX_PANES) {
      if (cli) cliFailed.current[cli.ask] = `its worktree already holds ${MAX_PANES} panes; open a tab with terminal create instead`;
      else setToast(`A workspace holds up to ${MAX_PANES} panes.`);
      return;
    }
    const pane: Pane = { key: nextKey.current++, cwd: src.cwd, branch: src.branch, agent: "shell", program: null, args: [], typed: cli?.command ?? undefined, ask: cli?.ask };
    // one pane split down becomes a stacked pair; a split right puts the pair side by side again
    const stack = dir === "down" && shown.length === 1;
    setStacked((st) => ({ ...st, [activeDir ?? ""]: stack }));
    const at = splitIndex(shown.map((c) => c.group), groupOf(src), dir, columnsFor(shown.length + 1, stack));
    setPanes(insertBefore(panes, shown[at]?.panes[0], pane));
    if (!cli) setFocused(pane.key);
  };

  const setChooser = (key: number, patch: Partial<Pane>) => {
    setPanes((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));
    setSheet((s) => (s && s.key === key ? { ...s, ...patch } : s));
  };
  const setSeats = (key: number, seats: Seat[]) => setChooser(key, { seats });

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
        return saveChanged(s, next);
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
    const chooser = panes.find((p) => p.key === key) ?? (sheet?.key === key ? sheet : undefined);
    if (!chooser) return;
    const inGrid = panes.some((p) => p.key === key);
    setLaunching(true);
    try {
      const picked = seats.map((s) => (s.agent === TERMINAL ? null : agents.find((a) => a.id === s.agent && a.installed) ?? null));
      const missing = seats.find((s, i) => s.agent !== TERMINAL && !picked[i]);
      if (missing) throw new Error(`${missing.agent} is not installed.`);
      const separate = inGitFor(chooser) && (chooser.copies ?? defaultCopies(seats.length, inGitFor(chooser))) === "separate";
      const pid = projectOf(chooser.cwd) ?? projectFor(null);
      const fresh = async (): Promise<{ cwd: string; branch: string | null }> => {
        if (!pid) throw new Error("Add a project first: an agent needs a project folder to work in.");
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
      // A grid chooser gives its place to the new panes; the New session page adds them (SESS-018).
      setPanes((ps) => (inGrid ? ps.flatMap((p) => (p.key === key ? made : [p])) : [...ps, ...made]));
      if (!inGrid) {
        setSheet(null);
        setScreen("terminals");
        setPage(null);
      }
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
      return await openIn(agent, dir, branch, prompt, show, extra, title);
    } catch (err) {
      setNotice(String(err));
      return null;
    }
  };
  // The start itself; it throws when the start line or the folder's trust cannot be set up, so a
  // caller that reports its own failure (VIEW-069) can say what did not start.
  const openIn = async (agent: AgentInfo, dir: string, branch: string | null, prompt: string, show: boolean, extra: string[] = [], title?: string) => {
    await pretrust(agent.id, [dir]);
    const line = await invoke<StartLine>("agent_start_line", { id: agent.id, extra, prompt });
    const key = nextKey.current++;
    const pane: Pane = { key, cwd: dir, branch, agent: markFor(agent.id), program: line.program ?? agent.program, args: line.args, env: line.env, title, typed: line.typed ?? undefined };
    // TERM-007: an empty pane in that workspace takes the session; else it gets a cell of its own.
    setPanes((ps) => {
      const free = freeCell(cellsOf(panesIn(ps, dir)));
      return free ? ps.map((p) => (p === free ? pane : p)) : [...ps, pane];
    });
    if (show) {
      setActiveDir(dir);
      setFocused(key);
    }
    return key;
  };
  // VIEW-011: the open page is written down, so it is shown again after a restart.
  useEffect(() => {
    if ((settings[OPEN_PAGE_FIELD] ?? null) !== page) saveSetting(OPEN_PAGE_FIELD, page);
  }, [page]);
  // VIEW-005: the screen in front is written down too, a burst of switches as one write and a
  // pending one before the window closes. The start screen itself is not written back.
  const screenWriter = useRef(
    lastWriter((s: Screen) => {
      setSettings((x) => ({ ...x, [LAST_SCREEN_FIELD]: s }));
      saveChanged({}, { [LAST_SCREEN_FIELD]: s }).catch((err) => setNotice(String(err)));
    }),
  ).current;
  const shownScreen = useRef(screen);
  useEffect(() => {
    if (shownScreen.current === screen) return;
    shownScreen.current = screen;
    screenWriter.set(screen);
  }, [screen]);
  // VIEW-107: closing the window writes what is pending first; unsaved editor text stops the quit
  // and asks, so nothing is lost without the user saying so.
  const [quitAsk, setQuitAsk] = useState<string[] | null>(null);
  const unsaved = useRef<string[]>([]);
  unsaved.current = panes.filter((p) => dirty[p.key]).map((p) => baseName(p.path ?? p.title ?? "Untitled"));
  const quitting = useRef(false);
  useEffect(() => {
    const off = getCurrentWindow().onCloseRequested((e) => {
      screenWriter.flush();
      if (quitting.current || unsaved.current.length === 0) return;
      e.preventDefault();
      setQuitAsk([...unsaved.current]);
    });
    return () => void off.then((f) => f()).catch(() => {});
  }, []);

  // PROJ-066: a click on a workspace row shows that workspace on the same click. Its panes were
  // kept while hidden, so they come back as they were; a workspace with no pane yet gets a shell.
  // TERM-005: `fresh` says the workspace was just made: its grid starts with the default pane
  // count, the shell counting as one and the rest empty. Only then, so nothing re-seeds later.
  const select = (dir: string, branch: string | null, fresh = false) => {
    setPage(null);
    recentDirs.current = [dir, ...recentDirs.current.filter((d) => !sameDir(d, dir))].slice(0, 20);
    setActiveDir(dir);
    if (screen === "artifacts") setScreen("terminals");
    if (panesIn(panes, dir).length > 0) setFocused((f) => focusIn(panes, dir, f));
    else {
      addShell(dir, branch);
      const more = fresh ? seedCount(settings[DEFAULT_PANES_FIELD], readLook(settings) === "classic") - 1 : 0;
      if (more > 0) setPanes((ps) => [...ps, ...Array.from({ length: more }, (): Pane => ({ key: nextKey.current++, cwd: dir, branch: null, agent: "shell", program: null, args: [], seats: [emptySeat()] }))]);
    }
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
  // CLI-026, CLI-027: the terminal commands. A new terminal joins the worktree's last pane as a
  // tab; unless asked to come into view it leaves that pane's shown tab and the focus as they were.
  const keyOfHandle = (h: string) => Number(Object.keys(ptys.current).find((k) => `term-${ptys.current[Number(k)]}` === h) ?? NaN);
  const showDir = (dir: string | null) => {
    setPage(null);
    if (dir !== null) recentDirs.current = [dir, ...recentDirs.current.filter((d) => !sameDir(d, dir))].slice(0, 20);
    setActiveDir(dir);
    setScreen("terminals");
  };
  const termCreate = (c: { path: string; branch: string | null; command: string | null; title: string | null; focus: boolean; ask: string }) => {
    const here = cellsOf(panesIn(panes, c.path));
    const last = here[here.length - 1];
    const key = nextKey.current++;
    if (last && !c.focus) {
      const on = last.panes.some((p) => p.key === activeTab[last.group]) ? activeTab[last.group] : last.panes[last.panes.length - 1].key;
      setActiveTab((m) => ({ ...m, [last.group]: on }));
    }
    setPanes((ps) => [...ps, { key, cwd: c.path, branch: c.branch, agent: "shell", program: null, args: [], typed: c.command ?? undefined, title: c.title ?? undefined, ask: c.ask, group: last?.group }]);
    if (c.focus) {
      showDir(c.path);
      setFocused(key);
    }
  };
  const termSwitch = (handle: string) => {
    const p = panes.find((x) => x.key === keyOfHandle(handle));
    if (!p) return;
    showDir(p.cwd);
    setFocused(p.key);
  };
  const termRename = (handle: string, title: string | null) => {
    const key = keyOfHandle(handle);
    setPanes((ps) => ps.map((p) => (p.key === key ? { ...p, title: title ?? undefined } : p)));
  };
  const cli = useRef({ startIn, select, removed, termCreate, termSwitch, termRename, splitPane, keyOfHandle, dropPane: (_k: number) => {} });
  cli.current = { startIn, select, removed, termCreate, termSwitch, termRename, splitPane, keyOfHandle, dropPane: (k: number) => dropPane(k) };
  useEffect(() => {
    const off = listen<CliWorkspace>("cli-workspace", (e) => {
      const p = e.payload;
      const c = cli.current;
      if (p.kind === "terminal-create") return c.termCreate(p);
      if (p.kind === "terminal-split") return c.splitPane(c.keyOfHandle(p.handle), p.dir, p);
      if (p.kind === "terminal-rename") return c.termRename(p.handle, p.title);
      if (p.kind === "terminal-switch") return c.termSwitch(p.handle);
      if (p.kind === "terminal-close") return p.handles.map(c.keyOfHandle).filter(Number.isFinite).forEach(c.dropPane);
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
      setNotice("Add a project first: an agent needs a project folder to work in.");
      return;
    }
    setLaunching(true);
    try {
      const wt = await invoke<Worktree>("workspace_create_fresh", { projectId: pid });
      // The agent's own start line (its options, permission mode and unpicked model default).
      if ((await startIn(agent, wt.path, wt.branch, "", true)) === null) return;
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
  /** Resolves true once at least one of the kit's AIs started. */
  const startKit = async (kit: Kit, values: Record<string, string>, assigned: (Vendor | null)[], dir: string): Promise<boolean> => {
    const before = await invoke<RunCheck | null>("kit_check", { dir }).catch(() => null);
    if (before && before.record.kit !== kit.id && kitConflict === null) {
      const other = KITS.find((k) => k.id === before.record.kit)?.title ?? before.record.title;
      setKitConflict(`This folder holds the results of \u201c${other}\u201d. Starting \u201c${kit.title}\u201d here puts both kits' results side by side.`);
      return false;
    }
    setKitConflict(null);
    setKits(null);
    const roles = kit.roles.map((r, i) => ({ id: r.id, ai: assigned[i] ?? "" }));
    const earlierName = datedName(before?.record.title ?? "Earlier run", before?.record.started ?? Date.now());
    // SKILL-015: a folder that is not a project or under samples, or an unknown kit, starts nothing.
    let prep: { started: number; earlier: string | null; earlierError: string | null; recordError: string | null };
    try {
      prep = await invoke("kit_prepare", { dir, kit: kit.id, title: kit.title, roles, earlierName });
    } catch (err) {
      setToast(`The kit did not start: ${String(err)}`);
      return false;
    }
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
    const prompts: string[] = [];
    for (const [i, role] of kit.roles.entries()) {
      const agent = agents.find((x) => x.id === assigned[i] && x.installed);
      const prompt = rolePrompt(kit, role, values);
      prompts.push(prompt);
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
      return false;
    }
    // The role-to-session mapping is kept only when every seat started.
    kitRuns.current[dir] = { started: prep.started, seats: started === keys.length ? keys : null, waiting, sent: {}, prompts };
    setKitTick((n) => n + 1);
    const words = [`${started} ${started === 1 ? "AI is" : "AIs are"} on the kit; most kits need 5 to 20 minutes.`];
    if (prep.earlier) words.push(`The last run's results were copied to kit-results\\${prep.earlier}.`);
    if (prep.earlierError) words.push(`The last run's results could not be copied: ${prep.earlierError}`);
    if (prep.recordError) words.push(`Kolux could not write the kit's run record, so its results may not be tracked: ${prep.recordError}`);
    if (started < keys.length) words.push(`${keys.length - started} of its roles did not start.`);
    setToast(words.join(" "));
    return true;
  };

  // ONB-001..005: the first-run wizard floats over the app while its record says it is open.
  const [wizard, setWizard] = useState<number | null>(null);
  const wizardSetup = useRef(false);
  useEffect(() => {
    invoke<{ step: number } | null>("onboarding_get").then((r) => setWizard(openAt(r)), () => {});
  }, []);
  // ONB-007: the close is stored before the wizard goes; a failed store keeps it open with a toast,
  // and the next click on any of its ways out tries that same close again.
  const [wizardClose] = useState(() =>
    closer(
      (outcome) => invoke("onboarding_close", { outcome }),
      () => {
        setWizard(null);
        wizardSetup.current = false;
      },
      (err) => setToast(`Kolux could not keep your setup progress (${String(err)}). Click the same button again to try once more.`),
    ),
  );
  const endWizard = (outcome: Outcome, after?: () => void) => wizardClose.end(outcome, after);
  // ONB-010: armed by Pick a folder, or by Skip while no project exists; the next project added
  // starts the saved default agent in it, once.
  const firstFolder = useRef(false);
  const projectAdded = (dir: string, branch: string | null) => {
    if (!firstFolder.current) return;
    firstFolder.current = false;
    const agent = firstFolderAgent(offeredAgents(agents, settings), defaultAgentId(settings));
    if (agent) void startIn(agent, dir, branch, "", true);
  };
  // ONB-005: Start kit launches at once in the kit's own sample folder with an AI ready; otherwise
  // the setup dialog opens, the wizard hides behind it, and a start from there completes it.
  const wizardKit = async (id: string) => {
    if (wizardClose.retry()) return;
    const kit = KITS.find((k) => k.id === id);
    if (!kit) return;
    const sampleDir = await invoke<string>("kit_samples_dir", { kit: id }).catch(() => null);
    if (activeDir && kitLaunch(activeDir, sampleDir, kitAIs) === "launch") {
      if (await startKit(kit, startValues(kit, activeDir, sampleDir, settings), assignRoles(kit, kitAIs), activeDir)) return endWizard("completed");
    } else setKitConflict(null);
    wizardSetup.current = true;
    setKits({ kit: id, sampleDir });
  };
  // ONB-005: one plain session on the first available agent (the default first), empty prompt;
  // nothing without an agent and a workspace.
  const wizardSession = async () => {
    if (wizardClose.retry()) return;
    const agent = menuAgents(offeredAgents(agents, settings), defaultAgentId(settings))[0];
    if (!agent || !activeDir) return;
    if ((await startIn(agent, activeDir, null, "", true)) !== null) endWizard("completed");
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
    const ask = panes.find((p) => p.key === key)?.ask;
    if (ask) cliFailed.current[ask] = error;
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
  // SKILL-013: Collect results copies every role's declared files into one dated folder.
  const kitCollect = async () => {
    if (!activeDir || !kitCheck) return;
    const kit = KITS.find((k) => k.id === kitCheck.record.kit);
    if (!kit) return setToast("Kolux does not know this kit any more, so it cannot collect its results.");
    const roles = kit.roles.map((r) => ({ id: r.id, title: r.title, files: r.delivers }));
    try {
      const got = await invoke<{ folder: string; copied: string[]; missing: string[] }>("kit_collect", { dir: activeDir, roles, name: datedName(kit.title, Date.now()) });
      const miss = got.missing.length ? ` ${got.missing.length} ${got.missing.length === 1 ? "file was" : "files were"} not there: ${got.missing.join(", ")}.` : "";
      setToast(`Collected ${got.copied.length} ${got.copied.length === 1 ? "file" : "files"} into kit-results\\${got.folder}, with a README and a Results page.${miss}`);
    } catch (err) {
      setToast(`Kolux could not collect the results this time: ${String(err)}`);
    }
  };
  // SKILL-012: Preview shows a result beside the role's session, in a split of its own that the
  // next preview uses again; it never replaces the AI's tab.
  const kitPreview = (i: number, file: string) => {
    const role = kitCheck?.record.roles[i];
    if (!activeDir || !role) return;
    const path = `${activeDir.replace(/[\\/]+$/, "")}\\kit-results\\${role.id}\\${file}`;
    const here = panesIn(panes, activeDir);
    const old = here.find((p) => p.kitPreview);
    const pane: Pane = { key: nextKey.current++, cwd: activeDir, branch: here[0]?.branch ?? null, agent: "shell", program: null, args: [], kind: previewKind(file), path, kitPreview: true };
    if (old) {
      setPanes((ps) => ps.map((p) => (p.key === old.key ? { ...pane, group: groupOf(old) } : p)));
    } else {
      const shown = cellsOf(here);
      if (shown.length >= MAX_PANES) return setToast(`A workspace holds up to ${MAX_PANES} panes; close one to preview ${file}.`);
      const seat = panes.find((p) => p.key === kitSeats[i]);
      const at = seat ? splitIndex(shown.map((c) => c.group), groupOf(seat), "right", columnsFor(shown.length + 1, false)) : shown.length;
      setPanes(insertBefore(panes, shown[at]?.panes[0], pane));
    }
    setFocused(pane.key);
  };
  const kitOpenFile = (i: number, file: string) => {
    const role = kitCheck?.record.roles[i];
    if (activeDir && role) invoke("kit_open_file", { dir: activeDir, role: role.id, file }).catch((err) => setToast(`Kolux could not open ${file}: ${String(err)}`));
  };
  // SKILL-011: Restart and Move to start one seat for the role on the chosen AI and make it the
  // role's session; with the settings unreadable nothing starts.
  const kitRestart = async (i: number, ai: string) => {
    const dir = activeDir;
    const check = kitCheck;
    const kit = check && KITS.find((k) => k.id === check.record.kit);
    const role = kit?.roles[i];
    if (!dir || !check || !kit || !role) return;
    try {
      await invoke("get_settings");
    } catch (err) {
      return setToast(`Nothing started: Kolux could not read its settings (${String(err)}).`);
    }
    const agent = agents.find((x) => x.id === ai && x.installed);
    if (!agent) return setToast(`${ai} is not installed, so the ${role.title} role cannot start there.`);
    const run = kitRuns.current[dir];
    const prompt = run?.started === check.record.started ? run.prompts[i] : undefined;
    if (!run || prompt === undefined) return setToast("Kolux no longer holds this run's inputs; start the kit again from Starter kits.");
    const waits = !!role.waitsFor && !roleDone(check, role.waitsFor);
    const key = await startIn(agent, dir, panesIn(panes, dir)[0]?.branch ?? null, waits ? "" : prompt, true, [], seatTitle(role, agent.id as Vendor));
    if (key === null) return;
    run.seats = (run.seats ?? kitSeats).map((k, n) => (n === i ? key : k));
    run.waiting = run.waiting.filter((w) => w.role !== role.id);
    if (waits && role.waitsFor) run.waiting.push({ role: role.id, upstream: role.waitsFor, key, prompt });
    else run.sent[role.id] = Date.now();
    setKitTick((n) => n + 1);
  };
  const terminals = screen === "terminals";
  const board = screen === "board";
  const inbox = screen === "inbox";
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
  const zoomed = terminals ? zoomedGroup(zoom, shown.map((c) => c.group)) : null;
  const gridCount = zoomed === null ? shown.length : 1;
  const activeOf = (c: (typeof cells)[number]) => (c.panes.some((p) => p.key === activeTab[c.group]) ? activeTab[c.group] : c.panes[c.panes.length - 1].key);
  // VIEW-023: a card's chip and lane; VIEW-025: an answer typed into the agent's own prompt.
  const chipFor = (p: Pane) => chipOf({ agent: p.agent, state: hook[p.key], running: running[p.key], stale: stale[p.key] ?? false, ...turn[p.key], since: stamp[p.key]?.at ?? 0 }, now);
  const laneOf = (p: Pane) => (p.seats || p.kind || p.agent === "shell" ? "idle" : (chipFor(p)?.lane ?? "idle"));
  const lanes = board ? LANES.filter((l) => panes.some((p) => laneOf(p) === l.id)) : [];
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
  // CLI-023: the command line learns where each terminal sits (its worktree pane, its tab, its
  // name, whether it is in view) from this report, sent whenever that changes.
  const layoutSent = useRef("");
  const reportLayout = () => {
    const rows: Record<string, unknown>[] = [];
    for (const c of cells) {
      const here = cells.filter((x) => sameDir(x.panes[0].cwd, c.panes[0].cwd));
      c.panes.forEach((p, i) => {
        const id = ptys.current[p.key];
        if (id !== undefined) rows.push({ handle: `term-${id}`, dir: p.cwd, cell: here.indexOf(c) + 1, tab: i + 1, title: tabName(p, titles), custom: p.title ?? null, shown: inView(p.key), ask: p.ask ?? null });
      });
    }
    for (const [ask, error] of Object.entries(cliFailed.current)) rows.push({ ask, error });
    const sent = JSON.stringify(rows);
    if (sent === layoutSent.current) return;
    layoutSent.current = sent;
    void invoke("terminal_layout", { rows }).catch(() => undefined);
  };
  const report = useRef(reportLayout);
  report.current = reportLayout;
  useEffect(() => report.current());
  // STAT-041: the note names the repository when more than one has agents running.
  const repoOf = (p: Pane): string | null => {
    const repos = new Set(panes.filter((x) => x.agent !== "shell" && x.cwd !== null).map((x) => folderName(x.cwd as string)));
    return repos.size > 1 && p.cwd !== null ? folderName(p.cwd) : null;
  };
  const noticed = (p: Pane, what: string, body = "", gate: KindKey = "notifyOnFinish") => {
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
    const off = listen<{ paneKey: number; children: Crew; tool?: string; detail?: string; wrote?: string } & Turn>("agent-status", (e) => {
      const { paneKey, state, children, tool, detail, reply, wrote, boundary, stop } = e.payload;
      setCrew((c) => (children.length === 0 && !(paneKey in c) ? c : { ...c, [paneKey]: children }));
      setTurn((t) => ({ ...t, [paneKey]: { tool, detail, reply, stop, wrote: boundary ? undefined : (wrote ?? t[paneKey]?.wrote) } }));
      setStale((m) => (m[paneKey] ? { ...m, [paneKey]: false } : m));
      const prev = hookRef.current[paneKey];
      // STAT-041: a finish, a permission request, a block, an interrupt or a sub-agent's turn is a note.
      const note = turnNote(prev, e.payload);
      if (note) {
        const p = panesRef.current.find((x) => x.key === paneKey);
        if (p) noticedRef.current(p, note.what, note.body, note.stopped ? "notifyOnStopped" : "notifyOnFinish");
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
  // The chooser, in a grid cell (SESS-007) or as the New session page (SESS-018).
  const renderChooser = (p: Pane & { seats: Seat[] }, hidden: boolean, focused: boolean, onFocus: () => void, onClose: () => void, sheetOf: { project: string; path: string } | null = null) => (
    <ChooserPane
      key={p.key}
      number={p.key}
      hidden={hidden}
      focused={focused}
      onFocus={onFocus}
      agents={agents}
      detecting={!agentPass.done}
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
      kit={p.kit ?? null}
      onKit={(kit) => setChooser(p.key, { kit })}
      vendors={kitAIs}
      onStart={(s) => void startSeats(p.key, s)}
      copies={p.copies ?? defaultCopies(p.seats.length, inGitFor(p))}
      inGit={inGitFor(p)}
      onCopies={(copies) => setChooser(p.key, { copies })}
      busy={launching}
      closable
      onClose={onClose}
      sheet={sheetOf}
      saved={Array.isArray(settings[SAVED_SHAPES_KEY]) ? (settings[SAVED_SHAPES_KEY] as SavedShape[]) : []}
      onSaved={(list) => saveSetting(SAVED_SHAPES_KEY, list)}
      onPickSaved={(t) => setChooser(p.key, { shape: "custom", seats: restoreShape(t, installedIds), task: t.task ?? "", copies: t.copies })}
    />
  );
  return (
    <div className="app">
      <Tip />
      <TopBar
        appName={chromeShown(settings, "titleBarAppName")}
        automations={
          chromeShown(settings, "automationsButton")
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
        onScreen={setScreen} installed={installedIds} onSearch={() => setPalette(true)} onBack={travel(hist, -1, stillThere) === null ? undefined : () => step(-1)} onForward={travel(hist, 1, stillThere) === null ? undefined : () => step(1)} sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((o) => !o)} rightOpen={terminals && right.open} onToggleRight={() => (terminals && right.open ? saveRight({ open: false }) : showRight(right.tab))} />
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
          <Ask
            title={asking.title}
            body={asking.body}
            confirm="Close tab"
            enter
            onCancel={() => setAsking(null)}
            onConfirm={() => {
              asking.keys.forEach(dropPane);
              setAsking(null);
            }}
          />
        )}
        {quitAsk && (
          <Ask
            title="Quit with unsaved changes?"
            body={`${quitAsk.length === 1 ? "1 file has" : `${quitAsk.length} files have`} unsaved changes: ${quitAsk.join(", ")}. Quitting now loses them.`}
            confirm="Quit without saving"
            cancel="Keep working"
            onCancel={() => setQuitAsk(null)}
            onConfirm={() => {
              quitting.current = true;
              setQuitAsk(null);
              void getCurrentWindow().close();
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
              saveChanged(settings, next).catch((err) => setNotice(String(err)));
            }}
            agents={agents}
            defaultId={defaultId}
            onSetDefault={setDefault}
            launching={launching}
            onLaunch={launch}
            onChoose={addChooser}
            onTerminal={() => void newTab(null)}
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
            onAdded={projectAdded}
            artifactsOn={screen === "artifacts"}
            onArtifacts={() => setScreen("artifacts")}
            onIndex={(list, dirs, typed) => {
              setProjects(list);
              setOwner(dirs);
              setNames(typed);
            }}
          />
        )}
        <div className="content">
          {sheet?.seats && (
            <div className="sheet-wrap">
              {(() => {
                const proj = projects.find((x) => x.id === (projectOf(sheet.cwd) ?? projectFor(null)));
                return renderChooser(sheet as Pane & { seats: Seat[] }, false, true, () => {}, () => setSheet(null), { project: proj?.name ?? "No project", path: sheet.cwd ?? proj?.path ?? "Home folder" });
              })()}
            </div>
          )}
          <SignInNotice />
          <KeyLostNotice />
          {terminals && page === null && <ToolNotices projects={projects.map((p) => p.id).join(",")} />}
          {terminals && page === "automations" && (
            <AutomationsPage
              onClose={() => setPage(null)}
              projects={projects}
              agents={agents}
              settings={settings}
              onSettings={(next) => {
                setSettings(next);
                saveChanged(settings, next).catch((err) => setNotice(String(err)));
              }}
            />
          )}
          {terminals && page === "tasks" && <TasksPage repo={tasksRepo(projects, activeDir)} />}
          {terminals && page === "routing" && (
            <RoutingPage
              agents={agents}
              settings={settings}
              onSettings={(next) => {
                setSettings(next);
                saveChanged(settings, next).catch((err) => setNotice(String(err)));
              }}
            />
          )}
          {terminals && (
            <>
              {page === null && activeDir && kitCheck && (
                <KitStrip
                  check={kitCheck}
                  seats={kitSeats.map((k) => (k === null ? null : { key: k, running: running[k], needs: needs[k], ai: aiOf(panes.find((p) => p.key === k) ?? { agent: "shell", program: null }) }))}
                  sent={kitRuns.current[activeDir]?.sent ?? {}}
                  now={Date.now()}
                  folded={kitFolded}
                  onFold={setKitFolded}
                  onOpen={() => invoke("kit_open_results", { dir: activeDir, folder: null }).catch((err) => setToast(`Kolux could not open the results folder: ${String(err)}`))}
                  connected={kitAIs}
                  onCollect={() => void kitCollect()}
                  onPreview={kitPreview}
                  onOpenFile={kitOpenFile}
                  onRestart={(i, ai) => void kitRestart(i, ai)}
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
          {inbox && <InboxView items={inboxItems(sources, now)} now={now} onOpen={openPane} />}
          {!terminals && !board && !inbox && screen !== "artifacts" && (
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
            className={board ? "board" : `grid${zoomed === null ? "" : " zoomed"}`}
            hidden={(!terminals && !board) || (terminals && page !== null)}
            style={terminals ? { gridTemplateColumns: `repeat(${columnsFor(gridCount, stacked[activeDir ?? ""])}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rowsFor(gridCount, stacked[activeDir ?? ""])}, minmax(0, 1fr))` } : board ? { gridTemplateColumns: `repeat(${lanes.length || 1}, minmax(0, 1fr))` } : undefined}
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
              {cells.map((c) => {
                const active = activeOf(c);
                return (
                  <div key={c.group} className="cell" hidden={!board && (!sameDir(c.panes[0].cwd, activeDir) || (zoomed !== null && c.group !== zoomed))}>
                    {c.panes.length > 1 && (
                      <div className="tabs" role="tablist" aria-label="Tabs">
                        {c.panes.map((p) => (
                          <div key={p.key} role="tab" aria-selected={p.key === active} className="tab" tabIndex={0} onMouseDown={() => setFocused(p.key)}>
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
                  <BrowserPane key={p.key} id={p.key} url={p.url ?? p.path} title={titles[p.key]} hidden={!terminals || settingsOpen || kits !== null || p.key !== active} focused={p.key === focused} onFocus={() => setFocused(p.key)} onClose={() => closePane(p.key)} />
                ) : p.kind === "editor" && p.path ? (
                  <EditorPane
                    key={p.key}
                    id={p.key}
                    path={p.path}
                    readOnly={p.kitPreview}
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
                  renderChooser(p as Pane & { seats: Seat[] }, !board && p.key !== active, p.key === focused, () => setFocused(p.key), () => closePane(p.key))
                ) : (
                  <TerminalPane
                    key={p.key}
                    hidden={!board && p.key !== active}
                    card={board ? { expanded: expanded === p.key, onToggle: () => setExpanded((x) => toggleCard(x, p.key)), chip: chipFor(p), column: columnOf(p), onAnswer: (ok) => void answer(p, ok), meter: p.seats || p.kind ? null : meterOf(context[p.key], p.agent, plan.claude, plan.codex, capOn(settings)) } : undefined}
                    cwd={p.cwd}
                    branch={p.branch}
                    agent={p.agent}
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
                    onPty={(id) => {
                      ptys.current[p.key] = id;
                      report.current();
                      if (p.batch !== undefined && p.agent !== "shell") rememberLineup(p.batch);
                    }}
                    onFailed={(error) => failedPane(p.key, error)}
                    onSplit={(dir) => splitPane(p.key, dir)}
                    expand={board ? undefined : { on: zoomed === groupOf(p), can: canExpand(shown.length, classic), toggle: () => expandPane(p.key) }}
                    title={p.title || nameOf(names, p.cwd)}
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
        <RightSidebar tab={right.tab} width={clampWidth(dragWidth ?? right.width, window.innerWidth, sidebarOpen ? 297 : 0)} hidden={!terminals || !right.open} onTab={(tab) => saveRight({ tab })} onWidth={(w, done) => {
          const used = clampWidth(w, window.innerWidth, sidebarOpen ? 297 : 0);
          setDragWidth(done ? null : used);
          if (done) saveRight({ width: used });
        }}>
        {scmOpen && (
          <SourceControlPanel dir={activeDir} writer={writerOf(settings)} draft={activeDir === null ? "" : (drafts[activeDir] ?? "")} onDraft={(text, dir) => (dir ?? activeDir) !== null && setDrafts((d) => ({ ...d, [dir ?? activeDir!]: text }))} onClose={() => saveRight({ open: false })} onFix={fixWithAI} pinnedBase={projects.find((p) => p.id === projectOf(activeDir))?.base ?? null} onChangeBase={(base) => {
            const p = projects.find((x) => x.id === projectOf(activeDir));
            if (p) void invoke<Project>("project_set", { projectId: p.id, workspacesDir: p.workspacesDir ?? "", base }).then((u) => setProjects((ps) => ps.map((x) => (x.id === u.id ? u : x))));
          }} againstUpstream={settings[SUMMARY_UPSTREAM_KEY] === true} groupOrder={settings[SCM_GROUP_ORDER_KEY]} onAgainstUpstream={(on) => saveSetting(SUMMARY_UPSTREAM_KEY, on)} fixAgent={settings[SCM_AGENT_KEY]} onFixAgent={(id) => saveSetting(SCM_AGENT_KEY, id)} linkedPr={activeDir === null ? null : (linkedPrs(settings[SCM_LINKED_PR_KEY])[activeDir] ?? null)} onLinkPr={(url) => activeDir !== null && saveSetting(SCM_LINKED_PR_KEY, withLink(linkedPrs(settings[SCM_LINKED_PR_KEY]), activeDir, url))} onAgentAction={async (a, prompt) => {
            if (activeDir === null) return "Open a workspace first.";
            try {
              await openIn(a, activeDir, panesIn(panes, activeDir)[0]?.branch ?? null, prompt, true);
              return null;
            } catch (err) {
              return `${a.name} did not start, so the conflicts were not handed over: ${String(err)}`;
            }
          }} agents={menuAgents(agents, defaultId)} onHand={(a, note) => activeDir !== null && void startIn(a, activeDir, panesIn(panes, activeDir)[0]?.branch ?? null, note, true)} />
        )}
        {activeDir ? <Explorer key={activeDir} root={activeDir} hidden={!explorerOpen} focusAsk={explorerFocus} onOpen={openFile} onClose={() => saveRight({ open: false })} /> : explorerOpen && <div className="sb-hint">Open a workspace to browse its files.</div>}
        </RightSidebar>
      </div>
      {kits && kits.kit === null && (
        <KitGallery
          connected={kitAIs}
          onPick={pickKit}
          onClose={() => setKits(null)}
          recent={kitRecent}
          onResults={(r) => invoke("kit_open_results", { dir: r.dir, folder: r.collected }).catch((err) => (setKits(null), setToast(`Kolux could not open the results of ${r.title}: ${String(err)}`)))}
          onProject={(r) => {
            const project = projects.find((p) => sameDir(p.path, r.dir));
            // The toast shows under the gallery, so the gallery closes for it.
            setKits(null);
            if (!project) return setToast(`No project in Kolux matches ${r.dir} any more; add the folder again to open it.`);
            setScreen("terminals");
            setActiveDir(project.path);
          }}
        />
      )}
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
              wizardSetup.current = false;
              chooserSetup.current = null;
            }}
            onStart={(values, assigned) => {
              const fromWizard = wizardSetup.current;
              const chooser = chooserSetup.current;
              // SKILL-005: real inputs are remembered for this workspace; a sample workspace's are not.
              const real = !!activeDir && !sameDir(activeDir, kits.sampleDir);
              if (real) saveSetting(RECALL_KEY, remember(settings, activeDir!, kit, values)[RECALL_KEY]);
              if (activeDir)
                void startKit(kit, values, assigned, activeDir).then((ok) => {
                  if (ok && fromWizard) endWizard("completed");
                  if (ok && chooser !== null) closePane(chooser);
                });
            }}
          />
        );
      })()}
      {wizard !== null && (
        <Wizard
          start={wizard}
          vendors={kitAIs}
          ping={settings["notifyOnFinish" satisfies KindKey] !== false}
          onPing={(on) => saveSetting("notifyOnFinish" satisfies KindKey, on)}
          hidden={kits !== null}
          onSample={openSamples}
          onKit={(id) => void wizardKit(id)}
          onSession={() => void wizardSession()}
          onPickFolder={() => {
            if (wizardClose.retry()) return;
            endWizard("completed", () => {
              firstFolder.current = true;
              window.dispatchEvent(new CustomEvent(ADD_PROJECT));
            });
          }}
          onClose={() => {
            if (wizardClose.retry()) return;
            const none = projects.length === 0;
            endWizard("dismissed", () => (firstFolder.current = none));
          }}
        />
      )}
      <UpdateCenter />
      {reviewOn(settings) && (
        <ReviewNotes
          picked={picked}
          notes={notes}
          onAdd={(n) => {
            setNotes((ns) => [...ns, n]);
            setPicked(null);
          }}
          onCancel={() => setPicked(null)}
          onRemove={(i) => setNotes((ns) => ns.filter((_, k) => k !== i))}
          onClear={() => setNotes([])}
        />
      )}
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
