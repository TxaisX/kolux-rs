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
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { saveChanged } from "./settings/saveChanged";
import { applySetting, applySettings } from "./projects/settingWrite";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import TopBar, { screens, type Screen } from "./chrome/TopBar";
import SettingsPage from "./settings/SettingsPage";
import Ask from "./chrome/Ask";
import TrustPrompt, {  } from "./setup/TrustPrompt";
import { setupRequestOf } from "./orchestration/workerSetup";
import { asksBeforeClose } from "./terminal/closing";
import { losable, quitQuestion, runningAgents, type Losable } from "./shell/closeAsk";
import { type Which } from "./terminal/tabClose";
import { bulkCloseSet, middleClickCloses, orderPinnedFirst } from "./terminal/pin";
import { halfOf, showsDragHandle, zoneOf } from "./terminal/rearrange";
import { chosenTab, cycleTab, openSwitcher, stepSwitcher, switchOrderOf, tabByNumber, type CycleMode } from "./terminal/tabCycle";
import { splitMenuState } from "./terminal/tabSplit";
import { moveToTab, tidyWeights } from "./shell/tidy";
import { chooserClosable } from "./launch/chooserClosable";
import { setTabColor, tabMenuHead, tabStyle, TAB_COLORS } from "./terminal/tabColor";
import { showScreen, zoomTerm } from "./theme";
import { useEscapeLeaves } from "./chrome/fullPage";
import SignInNotice from "./settings/SignInNotice";
import { watchCodexSignIn } from "./settings/codexSignInScan";
import KeyLostNotice from "./settings/KeyLostNotice";
import RecoveryMount from "./recovery/RecoveryMount";
import { LAST_SCREEN_FIELD, lastWriter, OPEN_PAGE_FIELD, saveLayout, stripOn } from "./settings/general";
import { cacheDue, cacheMinutes } from "./projects/cache";
import { startTail } from "./projects/startArgs";
import { openSettings } from "./settings/pages";
import WorktreePalette, { dirMark, dirMonitoring } from "./projects/WorktreePalette";
import { pasteHosts } from "./tasks/pasteHosts";
import { useRenameOnFirstPrompt } from "./projects/renameOnWork";
import FolderRenameAsk from "./projects/FolderRenameAsk";
import AboutPanel from "./shell/AboutPanel";
import LinkAskHost from "./shell/LinkAskDialog";
import TabSearch from "./shell/TabSearch";
import { openTabSearch } from "./shell/findTab";
import { navTarget, stepAllowed, travel, visit } from "./projects/nav";
import LayoutStrip, {  } from "./chrome/LayoutStrip";
import BrowserPane, { openInBrowser } from "./browser/BrowserPane";
import PreviewButton from "./browser/PreviewButton";
import { takeClosed } from "./browser/pages";
import { closedPanes, folderKind, paneFor, placement } from "./chrome/reopenTab";
import { writerOf } from "./scm/generate";
import { usePrRows } from "./scm/usePrRows";
import EditorPane, { editors } from "./editor/EditorPane";
import FloatingLayer, { floatingKeys } from "./floating/FloatingLayer";
import { baseName, keyOf } from "./editor/buffers";
import { useDesktopDrops } from "./editor/desktopDrops";
import { NOTHING_TO_SEND, sendRoute } from "./editor/noteCommands";
import { noteTarget, plainNote } from "./editor/fileNotes";
import { clearDelivered } from "./editor/diffNotes";
import LineNotes from "./scm/LineNotes";
import AgentStartHost from "./agentstart/AgentStartHost";
import ChecksPanel from "./scm/ChecksPanel";
import PreviewPane from "./editor/PreviewPane";
import { missingFileToast } from "./editor/linkClicks";
import TemplatePicker from "./editor/TemplatePicker";
import ReviewNotes from "./editor/ReviewNotes";
import { copiers } from "./editor/EditorPane";
import { reviewOn, selections, sendTargets, startChoices } from "./editor/notes";
import FilePicker, { quickOpenList, type Pick } from "./editor/FilePicker";
import ArtifactsPage from "./artifacts/ArtifactsPage";
import SkillsPage from "./skills/SkillsPage";
import { generatedOn, generatedTitle, tabText, tabTip } from "./shell/tabTitle";
import { needsBeat, statusTitle, useBeatFrame } from "./status/tabNameRule";
import { closeSkills, toggleSkills } from "./skills/nav";
import { BringSkillsUp } from "./skills/SkillBarItem";
import SkillUpdateNotice from "./skills/SkillUpdateNotice";
import Wizard from "./onboarding/Wizard";
import Guides from "./onboarding/Guides";
import { noteUse } from "./onboarding/features";
import DiffPane, { diffNav } from "./editor/DiffPane";
import AllChangesPane from "./editor/AllChangesPane";
import { DIFF_SPLIT_KEY, diffSplitOf } from "./scm/split";
import Explorer from "./editor/Explorer";
import AddProjectRow from "./editor/AddProjectRow";
import { useCloseGuard } from "./editor/CloseDialog";
import AgentsPanel from "./sessions/AgentsPanel";
import { BELL_NOTE } from "./terminal/bellNote";
import { FOLDER_TAB_KEY, rememberTab } from "./sessions/folderTabs";
import { AttachedWorktreesTab, FolderChecksTab } from "./projects/AttachedTabs.tsx"; // the extension: attachedTabs.ts (logic) differs only in case
import { useWindowSync } from "./sessions/windowSync";
import { useSessionNames } from "./sessions/tabTitles";
import RightSidebar, { clampLeft, clampWidth, Grip, LEFT_KEY, RIGHT_KEYS } from "./chrome/RightSidebar";
import { isMarkdown } from "./editor/markdown";
import { cellsOf, columnsFor, groupOf, rowsFor, toggleCard, canExpand, zoomedGroup } from "./terminal/grid";
import { gpuOn } from "./terminal/renderer";
import { DIVIDER_DONE, DRAG_ATTR, dragWeights, gapAt, templateOf, tracks } from "./terminal/dividers";
import StatusBar from "./chrome/StatusBar";
import { windowLoaded } from "./status/manage";
import { FileCode } from "./chrome/icons";
import AgentsRail from "./agents/AgentsRail";
import { cardPanes, pickSession, railGroups, rowStatus } from "./agents/rail";
import UpdateCenter from "./update/UpdateCenter";
import FeedbackDialog from "./feedback/FeedbackDialog";
import { FIELDS as STATUS_FIELDS, readStatusBar, toggleItem } from "./chrome/statusItems";
import { chromeShown } from "./chrome/chromeItems";
import VendorMark, { type Agent } from "./chrome/VendorMark";
import TerminalPane, {  } from "./terminal/TerminalPane";
import { codexSetup } from "./terminal/accountChange";
import ProjectsPanel, {  } from "./projects/ProjectsPanel";
import AutomationsPage from "./automations/AutomationsPage";
import { openRunTab, paneOfTerminal, runTabEnded, touchRunTab, typedInRunTab } from "./automations/runTab";
import RoutingPage from "./settings/RoutingPage";
import TasksPage from "./tasks/TasksPage";
import WorkspaceBoard from "./board/WorkspaceBoard";
import { tasksRepo } from "./tasks/model";
import SourceControlPanel from "./scm/SourceControlPanel";
import { aiControlsShown } from "./scm/rules";
import { SCM_AGENT_KEY, SCM_GROUP_ORDER_KEY, SCM_VIEW_KEY, SCM_LINKED_PR_KEY, SUMMARY_UPSTREAM_KEY, linkedPrs, withLink } from "./scm/model";
import { markFor, programWord } from "./launch/PlusMenu";
import { seatDefault } from "./launch/defaultSeat";
import { allSwitchedOff, menuAgents } from "./launch/agents";
import { SHOW_SLEEPING_SETTING, paneState, showSleepingFrom, strongest, type AgentState, type RowInfo } from "./projects/rows";
import { VOCAB, nextNeedsYou } from "./terminal/status";
import { IDLE, shownAgent } from "./terminal/shellMarks";
import type { KindKey } from "./settings/notifications";
import { tabBadge, waitingInGrid } from "./terminal/tabs";
import NameField from "./terminal/NameField";
import { Globe, Pin, Spinner, StatusGlyph } from "./chrome/icons";
import Tip from "./chrome/Tip";
import InboxView from "./inbox/InboxView";
import { inboxOverlay, onRunning, type Kept } from "./inbox/exitedPrompt";
import { inboxItems, sourceOf, type Source } from "./inbox/inbox";
import TowerView from "./tower/TowerView";
import FloorView from "./floor/FloorView";
import SpaceView from "./space/SpaceView";
import { nameSeats, nameUsage, towerRows, usageByAccount } from "./tower/tower";
import { useTowerBridge } from "./tower/TowerWindow";
import { LANES, chipOf, forget, hooksMuted, needsYou, promptReturned } from "./board/chip";
import { forceReload, reloadAsk, windowCommand } from "./keys/commands";
import { SCREEN_OF } from "./chrome/reach";
import Ring from "./usage/Ring";
import { capOn, codexOf, contextFill, meterOf, meterText, planOf, readsLeft, usageLine } from "./usage/meter";
import { cycleTarget, switcherLabel } from "./switcher/accounts";
import { readoutOf } from "./terminal/headerUsage";
import { useCodexPaneFigures } from "./usage/paneFigures";
import ChooserPane from "./launch/ChooserPane";
import { defaultCopies, restoreShape, SAVED_SHAPES_KEY, type Copies, type SavedShape, type Seat, type Shape, applyLineup, offeredLineup, type Lineup } from "./launch/seats";
import { folderName, NESTING_KEY, projectLabel, workItem, type Created, type CliWorkspace, type CliFile, type Project } from "./projects/model";
import { panesIn, sameDir, nameOf } from "./workspaces";
import { LAYOUT_FIELD, layoutOf, type SavedLayout } from "./terminal/layout";
import { layoutWriter } from "./terminal/layoutSave";
import { Kbd, KeymapProvider } from "./keys/KeymapContext";
import { recording } from "./keys/record";
import { matchEvent } from "./keys/keymap";
import { tapHit, windowTaps } from "./keys/tapHit";
import { heldByTerminal } from "./keys/terminalPolicy";
import { scopesFor } from "./keys/keyScopes";
import { useAgentEvents } from "./status/useAgentStatus";
import { useWindowStore, useWindowStoreTail } from "./shell/windowStore";
import type { WindowLate } from "./shell/windowLate";
import { launchActions } from "./launch/launchActions";
import { paneActions } from "./terminal/paneActions";
import { reviewActions } from "./editor/reviewActions";
import { TabBadge, tabName } from "./terminal/tabName";
import { useWindowStart } from "./shell/useWindowStart";
import { useSettingsPlumbing } from "./settings/useSettingsPlumbing";
import { useWindowChrome } from "./chrome/useWindowChrome";
import { useBrowserChords } from "./browser/useBrowserChords";
import { useRestoredStatus } from "./status/useRestoredStatus";
import { useGone } from "./status/gone";
import { workingByDir } from "./status/working";
import { creditedLive, launchedAgent, launchedName } from "./status/credit";
import { useWorkspaceActions } from "./projects/useWorkspaces";
import { stepZoom, zoomFactor } from "./settings/zoom";
import { useWizard } from "./onboarding/useWizard";
import { hooksOn } from "./onboarding/hooksOn";
import ToolNotices from "./launch/ToolNotices";
import { AgentsChat } from "./chat/ChatView";
import { linksOpenInKolux } from "./chat/chatLinks";
import { deliverPrompt, startWatch } from "./launch/startWatch";
import { hearStates, setHooksOn } from "./chat/send";
import PlanSheet from "./terminal/PlanSheet";
import EditMenuHost from "./editmenu/EditMenuHost";
import { draftKey, keepDraft, showsReview, stillPending } from "./terminal/planReview";

export type ShellTarget = { dir: string | null; branch: string | null };

/** A pane with `seats` is a chooser (SESS-007): nothing runs in it until Start. */
export type Pane = { /** EDIT-026: an editor tab that follows a growing log (read-only). */ follow?: boolean; key: number; cwd: string | null; branch: string | null; agent: Agent; agentId?: string; program: string | null; args: string[]; session?: string; forkOf?: string; resumed?: boolean; env?: [string, string][]; account?: string | null; /** T-139-d: the Codex setup (command, arguments, variables, permissions) it started with. */ setup?: string; seats?: Seat[]; copies?: Copies; shape?: Shape; task?: string; title?: string; word?: string; batch?: number; typed?: string; group?: number; kind?: "browser" | "editor" | "preview" | "diff" | "changes"; path?: string; url?: string; staged?: boolean; ask?: string; preview?: boolean; jump?: { line: number; at: number; col?: number; side?: "old" } };


/** Columns for a pane count: 1, side by side for 2, two rows for 3-4, then three across. */
/** `initial`: the settings read before the first frame (main.tsx), so the first screen is right at once. */
export default function App({ initial = {}, layout = null, read = true }: { initial?: Record<string, unknown>; layout?: SavedLayout | null; read?: boolean }) {
  return (
    <KeymapProvider>
      <Window initial={initial} layout={layout} read={read} />
    </KeymapProvider>
  );
}

/** The next screen in the Agents / Board / Terminals cycle. */
export function nextScreen(s: Screen): Screen {
  return screens[(screens.findIndex((x) => x.id === s) + 1) % screens.length].id;
}

function Window({ initial, layout, read }: { initial: Record<string, unknown>; layout: SavedLayout | null; read: boolean }) {
  // Cycle 2: what the moved actions read when they run, filled below once the window has made it (shell/windowLate.ts).
  const w = {} as WindowLate;
  // The window's state and its first hooks, in their order (shell/windowStore.ts).
  const store = useWindowStore(initial, layout);
  const {
    keymap, info, setInfo, screen, setScreen, settingsOpen, setSettingsOpen, boardOpen, setBoardOpen, settingsAt, setSettingsAt, expanded, setExpanded, zoom,
    sidebarOpen, setSidebarOpen, page, setPage, drafts, setDrafts, explorerFocus, setExplorerFocus, dragWidth, setDragWidth, dragLeft, setDragLeft,
    panes, setPanes, focused, setFocused, activeTab, setActiveTab, agentSel, setAgentSel, activeDir, setActiveDir, running, setRunning, codex, 
    reviewing, setReviewing, planDrafts, setPlanDrafts, plan, accountSwitcher, needs, setNeeds, hook, setHook, stamp,
    setStamp, turn, setTurn, stale, setStale, context, setContext, crew, setCrew, hookRef, runRef, unreadPanes, setUnreadPanes, unreadDirs, winFocused,
    markDir, rowRef, ptys, cliFailed, asking, setAsking, pinned, setPinned, switcher, setSwitcher, switcherRef, tabMenu, setTabMenu, tabColors, setTabColors,
    dragging, dropHint, setDropHint, recentTabs, titles, setTitles, liveIds, setLiveIds, liveRef, muteRef, guess, setGuess, agentOf, statusOf, allAgents,
    setAgents, agentPass, setAgentPass, shells, setShells, settings, setSettings, settingsRead, setSettingsRead, classic, sheet, setSheet, agents,
    dirty, setDirty, picking, setPicking, defaultId, installedIds, renameRequest, setRenameRequest, projects, setProjects, owner, setOwner, names, setNames,
    refresh, setRefresh, deleteRequest, setDeleteRequest, recentDirs, activeRef, createRequest, setCreateRequest, standIns, setStandIns, createName,
    setCreateName, hist, setHist, stacked, setStacked, palette, setPalette, notice, setNotice, toast, setToast
  } = store;
  const prRows = usePrRows(palette, (dir) => { setScreen("terminals"); select(dir, null); }); // VIEW-043: pull requests found by number or title, with their checks
  // The rest of the window's state (shell/windowStore.ts), after the pull-request rows.
  const tail = useWindowStoreTail({ accountSwitcher, ptys, setNotice }, layout, read);
  const {
    switchAccount, weights, setWeights, dragRef, launching, notes, setNotes, picked, setPicked, sendMenu, setSendMenu, askName, setAskName,
    renamingTab, setRenamingTab, nextKey, restoredKeys, runPanes, runTabs
  } = tail;
  const state = { ...store, ...tail };

  // App info, agents, shells and settings, read at start (shell/useWindowStart.ts).
  const {
    refreshAgents
  } = useWindowStart({
    activeDir, agentPass, focused, installedIds, nextKey, panes, setAgentPass, setAgents, setFocused, setInfo, setPanes, setSettings, setSettingsRead,
    setShells
  });
  // The settings writes, review notes, the right sidebar and the menu bar (settings/useSettingsPlumbing.ts).
  const plumb = useSettingsPlumbing({
    activeDir, classic, dragLeft, keymap, owner, refresh, screen, setExplorerFocus, setNotice, setScreen, setSettings, setSettingsAt, setSettingsOpen,
    setSidebarOpen, setToast, settings
  });
  const {
    settingsRef, repoless, notesFor, saveNotes, putNote, dropNotes, saveSetting, savePageSettings, wsKind, offeredRight, right,
    leftWidth, explorerOpen, scmOpen, saveRight, showRight, toggleExplorer, setDefault
  } = plumb;
  // The title's waiting count, page titles, the shortcuts notice, Classic and Settings links (chrome/useWindowChrome.ts).
  const {
    needing, keymapNotice
  } = useWindowChrome({ classic, info, keymap, needs, panes, setNotice, setScreen, setSettingsAt, setSettingsOpen, setTitles, statusOf });

  // BROW-003, BROW-005: the browser chords (browser/useBrowserChords.ts).
  const {
    browserAction
  } = useBrowserChords({ setFocused });

  // Global-scope shortcuts are pressed here, wherever focus is; with Terminal first (SET-014) a
  // focused terminal keeps every chord that is not marked safe for terminals. Only actions that exist today do something; the rest are matched and left alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // SET-009: while Settings > Shortcuts records a chord, the press is the recorder's alone.
      if (recording.on) return;
      // VIEW-109 (T-253): while an input method is composing every key is its own, shortcut chords included.
      if (e.isComposing || e.keyCode === 229) return;
      // TERM-059..061 (T-220): the floating panel's keys come first, on every screen.
      if (floatingKeys.handle(e)) return;
      const kind = screen === "terminals" ? panes.find((p) => p.key === focused)?.kind : undefined;
      const inTree = !!document.activeElement?.closest(".explorer"); // the explorer's own keys (EDIT-034) come with T-094-b
      // EDIT-001: in an editor the editor shortcuts come first and terminal ones do not apply;
      // the ones Kolux has no action for yet are left to CodeMirror.
      // SET-009: a modifier tapped twice runs the command bound to "Double+<modifier>" (keys/tapHit.ts).
      const hit =
        tapHit(windowTaps, keymap, e) ||
        (kind === "browser" && matchEvent(keymap, e, ["browser"])) ||
        matchEvent(keymap, e, scopesFor({ screen, kind, inTree })) ||
        // GIT-042: a preview tab takes the one editor shortcut that applies to it.
        (kind === "preview" && [matchEvent(keymap, e, ["editor"])].find((h) => h?.id === "editor.addReviewNote"));
      if (!hit || heldByTerminal(hit.id, settings)) return;
      const inFront = panesIn(panes, activeDir).some((p) => p.key === focused);
      switch (hit.id) {
        case "browser.focusAddressBar":
        case "browser.back":
        case "browser.forward":
        case "browser.reload":
        case "browser.find":
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
            // VIEW-050: a sidebar just opened lists its rows a moment later, so look again for up to a second.
            const focusList = (tries: number) => {
              const list = [...document.querySelectorAll<HTMLElement>(".sidebar :is(button.branch, .sess[role=button])")];
              if (list.length) (list.find((r) => r.classList.contains("sel")) ?? list[0]).focus();
              else if (tries > 0) setTimeout(() => focusList(tries - 1), 50);
            };
            focusList(20);
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
        case "sidebar.sleeping.toggle":
          saveSetting(SHOW_SLEEPING_SETTING, !showSleepingFrom(settings[SHOW_SLEEPING_SETTING]));
          break;
        case "workspace.openBoard":
          setBoardOpen((o) => !o);
          break;
        case "account.switchClaude":
        case "account.switchCodex": {
          // T-548: one key moves new panes to the provider's next account (wrapping through System default).
          const group = accountSwitcher.groups.find((g) => g.provider === (hit.id === "account.switchClaude" ? "claude" : "codex"));
          const to = group ? cycleTarget(group) : undefined;
          if (!group || to === undefined) return;
          switchAccount(group.provider, to);
          break;
        }
        case "view.code":
          leavePage();
          break;
        case "zoom.in":
        case "zoom.out":
        case "zoom.reset":
          // CHAT-026 (T-334): inside a chat the same chords zoom the chat text; the chat hears them itself.
          if (document.activeElement?.closest(".chat")) return;
          // BROW-012: a browser tab zooms its own page in its own steps.
          if (kind === "browser") {
            browserAction(focused, hit.id === "zoom.in" ? "zoomIn" : hit.id === "zoom.out" ? "zoomOut" : "zoomReset");
            break;
          }
          zoomTerm(focused, hit.id === "zoom.in" ? "in" : hit.id === "zoom.out" ? "out" : "reset"); // TERM-078
          break;
        case "ui.zoomIn":
        case "ui.zoomOut":
        case "ui.zoomReset":
          // SET-019 (T-246-c): the saved interface zoom, which has keys of its own apart from the pane zoom above.
          void stepZoom(hit.id === "ui.zoomIn" ? "in" : hit.id === "ui.zoomOut" ? "out" : "reset").catch(() => {});
          break;
        case "tab.newTerminal":
          void newTab(null);
          break;
        case "tab.nextSameType":
        case "tab.previousSameType":
        case "tab.nextAllTypes":
        case "tab.previousAllTypes":
        case "tab.nextTerminal":
        case "tab.previousTerminal":
        case "tab.selectByIndex": {
          // TERM-051 / TERM-052: the tabs of the front cell in strip order.
          const strip = orderOf(focused).map((k) => panes.find((x) => x.key === k)).filter((x): x is Pane => !!x);
          const to =
            hit.id === "tab.selectByIndex"
              ? tabByNumber(strip, (hit.index ?? 0) + 1)
              : cycleTab(strip, focused, hit.id.startsWith("tab.next") ? 1 : -1, (hit.id.endsWith("SameType") ? "same" : hit.id.endsWith("AllTypes") ? "all" : "terminals") as CycleMode);
          if (to === null) return;
          setFocused(to);
          break;
        }
        case "tab.previousRecent": {
          // TERM-050: the first press opens the list on the tab used just before; each press while Ctrl is held steps on, and letting go switches.
          const open = switcherRef.current;
          const next = open ? stepSwitcher(open, 1) : openSwitcher(panesIn(panes, activeDir).map((x) => x.key), recentTabs.current, focused, switchOrderOf(settings));
          if (!next) return;
          setSwitcher(next);
          break;
        }
        case "tab.nextRecent": {
          // AFTER 119: Ctrl+Shift+Tab steps the open switcher back; with it closed it opens on the oldest tab.
          const open = switcherRef.current;
          const first = open ? null : openSwitcher(panesIn(panes, activeDir).map((x) => x.key), recentTabs.current, focused, switchOrderOf(settings));
          const next = open ? stepSwitcher(open, -1) : first ? stepSwitcher({ ...first, at: 0 }, -1) : null;
          if (!next) return;
          setSwitcher(next);
          break;
        }
        case "tab.newBrowser":
          void newTab("browser");
          break;
        case "editor.copyContext":
          if (!copiers.get(focused)?.()) return;
          break;
        case "sourceControl.sendReviewNotes": {
          // GIT-041 (T-034-b): the Markdown notes go through the Send menu; a workspace's line notes
          // are pasted into its agent at once.
          if (!reviewOn(settings)) return;
          const how = sendRoute(true, notes.length, activeDir === null ? 0 : notesFor(activeDir).length);
          if (how === "menu") setSendMenu(true);
          else if (how === "lines" && activeDir !== null) void sendNotes(activeDir).then((why) => setToast(why ?? "The review notes were sent to the agent."));
          else setToast(NOTHING_TO_SEND);
          break;
        }
        case "editor.addReviewNote": {
          // EDIT-020: holding the keys adds one note.
          if (e.repeat) break;
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
        case "tab.reopenClosed": {
          // TERM-047 / T-239 (BROW-019): the tab closed last, terminal or browser, comes back: a terminal in
          // its folder (or the shown workspace when that is gone), a browser page at the address it had.
          void closedPanes.take(folderKind, activeDir).then((r) => {
            if (r.kind === "browser") {
              const page = takeClosed();
              if (page) openInBrowser(page.url);
            } else if (r.kind === "terminal") {
              const key = nextKey.current++;
              const dir = r.pane.cwd || null;
              setPanes((ps) => [...ps, paneFor(r.pane, key, placement(ps, focused, dir))]);
              setScreen("terminals");
              if (!sameDir(dir, activeDir)) setActiveDir(dir);
              setFocused(key);
            }
          });
          break;
        }
        case "tab.closeAll":
          // TERM-044: every tab of the focused pane's strip, through one close question.
          if (!inFront) return;
          void closeTab(bulkCloseSet(orderOf(focused), focused, "all", pinned));
          break;
        case "terminals.focusNextNeedsYou": {
          // TERM-030: cycle through the panes waiting on the user in grid order, across workspaces;
          // with none waiting, focus stays where it is. DT-C52: a permission or a question only (the one status).
          const k = nextNeedsYou(panes.filter((p) => p.kind !== "browser").map((p) => p.key), new Set(panes.filter((p) => needsYou(statusOf(p))).map((p) => p.key)), focused);
          if (k === null) return;
          openPane(k); // EDIT-041: the same jump as Open in Code
          break;
        }
        case "tab.search": // TERM-053
          openTabSearch();
          break;
        case "terminal.setTitle":
        case "terminal.clearPaneTitle":
        case "tab.rename": {
          // TERM-027, TERM-048: name the focused chat or terminal; in a cell with tabs, the tab
          // strip takes the rename, else the pane header does. No default key on Windows.
          const p = inFront ? panes.find((x) => x.key === focused && !x.kind) : undefined;
          if (!p) return;
          if (hit.id === "terminal.clearPaneTitle") {
            if (!p.title) return;
            renamePane(p.key, undefined);
          } else if (hit.id === "tab.rename" && panes.filter((x) => groupOf(x) === groupOf(p)).length > 1) setRenamingTab(p.key);
          else setAskName((m) => ({ ...m, [p.key]: (m[p.key] ?? 0) + 1 }));
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
        case "terminal.equalizePaneSizes":
          if (!inFront) return;
          equalizePanes();
          break;
        default: {
          // T-610: a command that shows a screen (chrome/reach.ts) toggles it with Terminals.
          const to = SCREEN_OF[hit.id];
          if (to) {
            setScreen((s) => (s === to ? "terminals" : to));
            break;
          }
          // T-611: the commands this switch had no case for (keys/commands.ts).
          if (windowCommand(hit.id, {
            toggleRight: (tab) => (terminals && right.open && right.tab === tab ? saveRight({ open: false }) : showRight(tab)),
            renameWorkspace: () => {
              setScreen("terminals");
              setSidebarOpen(true);
              setRenameRequest((n) => n + 1);
            },
            // Review of PR #16 (a): unsaved editor text is asked about first, in the app's own question, else it reloads at once.
            reload: () => void forceReload(unsaved.current, setReloadAsk, () => location.reload()),
          })) break;
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

  // TERM-050: letting go of Ctrl switches to the chosen tab; Escape or leaving the window drops the list.
  useEffect(() => {
    const done = (go: boolean) => {
      const s = switcherRef.current;
      if (!s) return;
      setSwitcher(null);
      if (go) setFocused(chosenTab(s));
    };
    const up = (e: KeyboardEvent) => e.key === "Control" && done(true);
    const down = (e: KeyboardEvent) => e.key === "Escape" && switcherRef.current && (e.preventDefault(), e.stopPropagation(), done(false));
    const lost = () => done(false);
    window.addEventListener("keyup", up, true);
    window.addEventListener("keydown", down, true);
    window.addEventListener("blur", lost);
    return () => {
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("blur", lost);
    };
  }, []);

  // The launch and pane actions (launch/launchActions.ts, terminal/paneActions.ts).
  const launchA = launchActions(state, plumb, w);
  const {
    lineupsOf, rememberLineup, inGitFor, startSeats, startIn, openIn, resumeIn, resumeOrFocus, runSetup, gateSetup, fromItem, fromName, 
    fixWithAI, projectFor, launch
  } = launchA;
  const {
    addShell, addChooser, removeSession, openTerminalIn, newTab, openFile, followLink, openDiff, openPreview, setCount, expandPane, splitPane, setChooser,
    setSeats, stillThere, step, paletteItems, keyOfHandle, termCreate, termSwitch, renamePane, termRename, failedPane, noticeFor,
    orderOf, dropPanes, dropPane, dropTabOn, dropCellOn, splitTab, closeTab, closePane, leavePage, runPane, copyId, findHandle, openPane, reviewChanges,
    addPreset
  } = paneActions(state, plumb, launchA, { prRows }, w);
  // EDIT-039: a file dragged in from the desktop opens here; a folder on the project list is added there.
  useDesktopDrops((path) => openFile(path), setToast);


  // APP-019: markdown files the system handed to the app open as previews, at start and on each later ask.
  const openFiles = useRef(openPreview);
  openFiles.current = openPreview;
  useEffect(() => {
    const drain = () => void invoke<string[]>("open_files_take").then((fs) => fs.forEach((f) => openFiles.current(f))).catch(() => undefined);
    const off = listen("open-files", drain);
    drain();
    return () => void off.then((f) => f()).catch(() => undefined);
  }, []);


  // SESS-021: a lineup is kept per project once one of its agent seats has really started (its
  // pane reports a running program); until then it waits here under its batch.
  const pendingLineup = useRef<Record<number, { pid: string; lineup: Lineup }>>({});

  // SESS-005 (T-163): every shown agent pane is watched for a terminal process from the moment it
  // is shown; onPty marks it seen, and a pane with none after five seconds gets a warning toast.
  useEffect(() => {
    const here = panesIn(panes, activeDir).filter((p) => p.agentId && p.program && !p.seats && !p.kind);
    startWatch.prune(here.map((p) => p.key));
    for (const p of here) startWatch.arm(p.key, agents.find((a) => a.id === p.agentId)?.name ?? String(p.agentId), setToast);
  }, [panes, activeDir, agents]);
  // STAT-039 (T-110-b): a prompt typed into an agent started without one names the branch too.
  useRenameOnFirstPrompt((key) => panes.find((p) => p.key === key)?.cwd ?? undefined, settings);
  // VIEW-093 (T-127-b): an agent tab takes its session's name (the user's own tab name still wins).
  useSessionNames(panes);
  const { afterSetup, startSetup, select, removedAll, removed, projectOf } = useWorkspaceActions({ panes, setPanes, setFocused, setActiveDir, setStacked, nextKey, settings, screen, setScreen, setPage, owner, recentDirs, activeRef });
  const setupExits = useRef<Record<number, (code: number | null) => void>>({});
  // VIEW-011: the open page is written down, so it is shown again after a restart.
  useEffect(() => {
    if ((settings[OPEN_PAGE_FIELD] ?? null) !== page) saveSetting(OPEN_PAGE_FIELD, page);
  }, [page]);
  // VIEW-005: the screen in front is written down too, a burst of switches as one write and a
  // pending one before the window closes. The start screen itself is not written back.
  const screenWriter = useRef(
    lastWriter((s: Screen) => {
      // Row 794-d: moves the ref too, so a saveSetting before the next render keeps the last screen.
      setSettings(applySetting(settingsRef, LAST_SCREEN_FIELD, s).next);
      saveChanged({}, { [LAST_SCREEN_FIELD]: s }).catch((err) => setNotice(String(err)));
    }),
  ).current;
  const shownScreen = useRef(screen);
  useEffect(() => {
    if (shownScreen.current === screen) return;
    shownScreen.current = screen;
    screenWriter.set(screen);
  }, [screen]);
  // VIEW-007: another window changing its screen moves this one too, unless a page (Tasks, Automations, ...)
  // is open here; the followed screen counts as already saved, so it is not written back.
  useWindowSync({
    field: LAST_SCREEN_FIELD,
    valid: screens.map((x) => x.id),
    screen,
    page,
    ready: settingsRead,
    onScreen: (to) => {
      shownScreen.current = to;
      setScreen(classic && (to === "agents" || to === "board") ? "terminals" : to);
    },
  });
  // VIEW-107: closing the window writes what is pending first; unsaved editor text stops the quit
  // and asks, so nothing is lost without the user saying so.
  // T-182 (APP-006): agents still running are asked about too (while TERM-045's switch is on).
  const [quitAsk, setQuitAsk] = useState<Losable | null>(null);
  const [reloadAsking, setReloadAsk] = useState<string[] | null>(null); // Review of PR #16 (a): Force Reload's question
  const unsaved = useRef<string[]>([]);
  unsaved.current = panes.filter((p) => dirty[p.key]).map((p) => baseName(p.path ?? p.title ?? "Untitled"));
  const busyAgents = useRef<string[]>([]);
  busyAgents.current = runningAgents(panes, running, asksBeforeClose(settings));
  const quitting = useRef(false);
  // T-075 (APP-048 / APP-050): a burst of layout changes is one write, and the pending one is
  // flushed before the window closes, so a change made right before quitting is back on relaunch.
  const layoutSaver = useRef(layoutWriter((l: SavedLayout) => saveLayout(l, (v) => saveChanged({}, { [LAYOUT_FIELD]: v })).catch((err) => { setNotice(String(err)); throw err; }))).current;
  useEffect(() => {
    const off = getCurrentWindow().onCloseRequested(async (e) => {
      // T-182 (APP-006): the page answers at once; a page that cannot is closed for by the Rust side.
      void invoke("close_alive").catch(() => {});
      screenWriter.flush();
      const saved = layoutSaver.flush();
      if (quitting.current) {
        // after-list #37: the window closes only once the last layout write has landed (or failed).
        await saved;
        return;
      }
      // APP-007: with "Closing the window keeps Kolux in the tray" on, the window hides instead (tray.rs
      // decides: Windows, option on, tray icon present, no quit under way); nothing is lost, so the
      // unsaved-changes question is skipped. Quit from the tray and File > Exit report `quitting` and
      // go on to the question below, exactly as the close button does.
      const tray = await invoke<{ hid: boolean; quitting: boolean }>("tray_close_requested").catch(() => ({ hid: false, quitting: false }));
      if (tray.hid) {
        e.preventDefault();
        return;
      }
      const l = losable(unsaved.current, busyAgents.current);
      if (l) {
        e.preventDefault();
        setQuitAsk(l);
        return;
      }
      // after-list #37: the window closes only once the last layout write has landed (or failed).
      await saved;
    });
    return () => void off.then((f) => f()).catch(() => {});
  }, []);
  // PROJ-067: the tabs and layout are written down as they change, so they come back after a restart.
  // VIEW-107 (T-069-b): not before the saved tabs are back (`read`): a start that timed out has not put
  // them back, so writing its layout would drop them, even once its own settings read lands (T-597:
  // main.tsx draws the window again with them when the settings answer). A failed write is retried
  // once, then only the durable part is written.
  useEffect(() => {
    if (!read) return;
    const l = layoutOf(panes, activeTab, focused, activeDir, stacked, { pinned, colors: tabColors });
    if (JSON.stringify(settings[LAYOUT_FIELD] ?? null) === JSON.stringify(l)) return;
    const next = { ...settingsRef.current, [LAYOUT_FIELD]: l };
    settingsRef.current = next;
    setSettings(next);
    layoutSaver.set(l);
  }, [panes, activeTab, focused, activeDir, stacked, pinned, tabColors]);

  // VIEW-046: every workspace and page shown is a stop for back and forward; a step back lands on
  // the place already current, which visit leaves alone.
  useEffect(() => setHist((h) => visit(h, { dir: activeDir, page })), [activeDir, page]);

  // CLI-022: `file open` / `file diff` / `file open-changed` name files of some worktree; the window goes
  // there first and opens the tabs once that worktree is the active one.
  const [cliFiles, setCliFiles] = useState<CliFile[]>([]);
  useEffect(() => {
    const ready = cliFiles.filter((f) => sameDir(f.worktree, activeDir));
    if (ready.length === 0) return;
    setCliFiles((q) => q.filter((f) => !ready.includes(f)));
    for (const f of ready) {
      void (async () => {
        let failed: string | null = null;
        try {
          // Row 65: a file that vanished since the command looked is refused with a reason, not reported opened.
          if (f.kind === "file-open" && (await missingFileToast(f.path, (ps) => invoke<unknown[]>("file_stamps", { paths: ps })))) failed = "the file is not there (or is outside this project)";
          else if (f.kind === "file-open") openFile(f.path);
          else openDiff(f.path, f.staged);
        } catch (err) {
          failed = String(err);
        }
        // T-250-c: tell the command line what became of the tab (a file that never gets here is unconfirmed).
        if (f.ack !== undefined) void invoke("cli_file_result", { id: f.ack, failed }).catch(() => undefined);
      })();
    }
  }, [cliFiles, activeDir]);
  // T-250-c: while this window runs, the command line waits for its answers about the files it asked to open.
  useEffect(() => {
    void invoke("cli_file_window", { listening: true }).catch(() => undefined);
    return () => void invoke("cli_file_window", { listening: false }).catch(() => undefined);
  }, []);
  const cli = useRef({ startIn, select, removed, termCreate, termSwitch, termRename, splitPane, keyOfHandle, startSetup, runSetup, gateSetup, dropPane: (_k: number) => {} });
  cli.current = { startIn, select, removed, termCreate, termSwitch, termRename, splitPane, keyOfHandle, startSetup, runSetup, gateSetup, dropPane: (k: number) => dropPane(k) };
  // AUTO-011 (T-085-g): a run's own agent tab shuts by itself, once, when that agent exits, unless the user
  // clicked (the pane's mouse-down above) or typed in it (a key inside the focused pane) or pinned it.
  const focusedNow = useRef(focused);
  focusedNow.current = focused;
  const pinnedNow = useRef(pinned);
  pinnedNow.current = pinned;
  useEffect(() => {
    const typed = (e: KeyboardEvent) => {
      const inside = e.target instanceof Element && e.target.closest(".pane.focused") !== null;
      if (typedInRunTab(runTabs.current, focusedNow.current, inside)) runTabs.current = touchRunTab(runTabs.current, focusedNow.current);
    };
    document.addEventListener("keydown", typed, true);
    const off = listen<{ id: number; code?: number | null; session?: string }>("terminal-exit", (e) => {
      const key = paneOfTerminal(ptys.current, e.payload.id);
      if (key === null) return;
      const printed = e.payload.session; // T-066-d: the id an id-only agent printed in its own resume hint; a hook's id is never replaced
      if (printed) setPanes((ps) => ps.map((p) => (p.key === key && !p.session ? { ...p, session: printed } : p)));
      setupExits.current[key]?.(e.payload.code ?? null);
      const ended = runTabEnded(runTabs.current, key, pinnedNow.current.has(key));
      runTabs.current = ended.tabs;
      if (ended.verdict === "close") cli.current.dropPane(key);
    });
    return () => {
      document.removeEventListener("keydown", typed, true);
      off.then((f) => f()).catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    const off = listen<CliWorkspace>("cli-workspace", (e) => {
      const p = e.payload;
      const c = cli.current;
      if (p.kind === "file-open" || p.kind === "file-diff") {
        if (!sameDir(p.worktree, activeRef.current)) c.select(p.worktree, p.branch);
        return setCliFiles((q) => [...q, p]);
      }
      if (p.kind === "terminal-create") return c.termCreate(p);
      if (p.kind === "terminal-split") return c.splitPane(c.keyOfHandle(p.handle), p.dir, p);
      if (p.kind === "terminal-rename") return c.termRename(p.handle, p.title);
      if (p.kind === "terminal-switch") return c.termSwitch(p.handle);
      if (p.kind === "terminal-close") return p.handles.map(c.keyOfHandle).filter(Number.isFinite).forEach(c.dropPane);
      setRefresh((n) => n + 1);
      if (p.kind === "repo" || p.kind === "changed") return;
      if (p.kind === "removed") {
        cli.current.removed(p.path);
        return;
      }
      // ORCH-016: a worker starts as a background tab in its worktree, named after its task.
      if (p.kind === "start") {
        const a = agents.find((x) => x.id === p.agent);
        if (a)
          void cli.current.startIn(a, p.path, p.branch, ...startTail(p)).then((key) => {
            // AUTO-013: an automation run remembers its pane, so View run opens that terminal.
            if (key !== null && p.runId) {
              runPanes.current[p.runId] = key;
              runTabs.current = openRunTab(runTabs.current, key, p.runId);
            }
          });
        return;
      }
      const a = p.agent ? agents.find((x) => x.id === p.agent) : undefined;
      // PROJ-033: a workspace made from the command line runs its setup script in a background tab
      // unless it was told to skip it. SESS-026 (T-150): the setup settles (asked, opened or said
      // why not) before its agent starts.
      // ORCH-017 (T-172-d): a worker-start's notice carries a request; worker-start waits for its answer.
      const request = setupRequestOf(p);
      const setup = p.setup === "skip" ? Promise.resolve() : request ? cli.current.gateSetup(request, p.worktree.path, p.worktree.branch) : cli.current.runSetup(p.worktree.path, p.worktree.branch);
      if (a) void setup.then(() => cli.current.startIn(a, p.worktree.path, p.worktree.branch, p.prompt, p.activate));
      else if (p.activate) cli.current.select(p.worktree.path, p.worktree.branch);
    });
    return () => {
      off.then((f) => f()).catch(() => undefined);
    };
  }, [agents]);


  const { wizard, wizardClose, endWizard, firstFolder, projectAdded, wizardSession, pickFolder } = useWizard({ setToast, agents, settings, activeDir, startIn });

  useEffect(() => void hearStates(listen).catch(() => {}), []);
  // Stand-in review of 1e9613e, FIX-SOON 2: hooks off in Settings drop the chat's readings.
  useEffect(() => setHooksOn(hooksOn(settings)), [settings]);

  // T-035-b: the question or permission a program left open when it exited; only the Inbox reads it (inbox/exitedPrompt).
  const exitedPrompt = useRef<Kept>({});

  const guard = useCloseGuard({ panes, dirty, close: (keys) => void closeTab(keys, true), toast: setToast });

  const terminals = screen === "terminals";
  const board = screen === "board";
  const inbox = screen === "inbox";
  const tower = screen === "tower";
  const floor = screen === "floor";
  const space = screen === "space";
  const agentsScreen = screen === "agents";
  // T-050-b: an orchestrator-started session with no name or title is named after its worker's task
  // (orchestration worker_labels, by terminal handle), looked up while the Agents screen, the Board or
  // the tab strip is open (ORCH-066 / T-129-d: Board rows and generated titles read the same label).
  const [workerNames, setWorkerNames] = useState<Record<string, string>>({});
  const labelOf = (p: Pane) => workerNames[`term-${ptys.current[p.key]}`];
  // TERM-056 / T-258: the tab's text and its hover (the full title); generated titles (off by default) touch only
  // terminal panes without a name of their own.
  // STAT-035 / T-124-b: the tab-name rule on top of the followed title: Kolux names ready and action required for agents whose own titles do not, and one shared beat animates its spinners.
  const ruleOf = (p: Pane) => ({ named: Boolean(labelOf(p) || p.title?.trim()), agent: p.kind ? null : launchedAgent(p), name: launchedName(p) ?? programWord(p.agent), live: liveIds[p.key]?.title, state: hook[p.key] });
  const beatFrame = useBeatFrame(panes.filter((p) => needsBeat(ruleOf(p))).map((p) => p.key));
  const tabLabel = (p: Pane) => {
    const full = statusTitle({ ...ruleOf(p), shown: tabName(p, titles, labelOf(p), liveIds), frame: beatFrame });
    const shown = p.kind ? full : tabText({ full, own: p.title, on: generatedOn(settings), generated: generatedTitle({ label: labelOf(p), word: p.agent === "shell" ? "Shell" : programWord(p.agent), branch: p.branch, cwd: p.cwd }) });
    return (
      <span className="tab-name" data-tip={tabTip(full, shown)}>
        {shown}
      </span>
    );
  };
  useEffect(() => {
    if (!agentsScreen && !board && !terminals) return;
    const look = () => void invoke<Record<string, string>>("worker_labels").then(setWorkerNames, () => {});
    look();
    const t = window.setInterval(look, 5000);
    return () => window.clearInterval(t);
  }, [agentsScreen, board, terminals]);
  // STAT-050: the Inbox and the Board read the panes the window already tracks; the clock ticks while one is open.
  const [now, setNow] = useState(Date.now());
  const timed = inbox || board || tower;
  // VIEW-009: a full page fills the workspace area; Show Code (view.code) and an Escape nothing else used leave it.
  // T-146-e: Skills and Space are full pages too; Skills keeps its own Escape (closeSkills returns to the screen it came from).
  const fullPage = settingsOpen || (terminals && page !== null) || inbox || tower || floor || space || screen === "artifacts" || screen === "skills";
  useEscapeLeaves(fullPage && !settingsOpen && page !== "automations" && screen !== "skills", leavePage);
  useEffect(() => showScreen(screen, classic), [screen, classic]); // VIEW-006: each screen's own theme
  useEffect(() => {
    if (!timed) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [timed]);
  const sources: Source[] = panes
    .filter((p) => !p.kind && !p.seats)
    // Review of PR #16 (b): the agent the pane carries (agentOf), so the Inbox names Gemini, not PowerShell.
    .map((p) => sourceOf({ ...p, agent: agentOf(p) }, tabName(p, titles), statusOf(p), running[p.key], stamp[p.key]));
  // T-035-b: the Inbox sees an exited pane's open prompt; a restart, a closed pane or a fresh hook state drops it.
  const inboxSeen = inboxOverlay(sources, exitedPrompt.current, hook);
  exitedPrompt.current = inboxSeen.kept;
  const [reveal, setReveal] = useState(0);
  const live = panes.filter((p) => running[p.key]);
  const openDirs = panes.map((p) => p.cwd).filter((d): d is string => d !== null);
  // PROJ-063 / PROJ-050: a workspace row shows the strongest state among its panes, and remembers
  // when that last moved so the smart sort can put the newest change first.
  const byDir: Record<string, AgentState[]> = {};
  // STAT-001: a hook-fed state wins over the guess from the program's state.
  for (const p of panes) if (p.cwd !== null && p.kind !== "browser" && !p.seats) (byDir[p.cwd] ??= []).push(statusOf(p) ?? paneState(p.agent, running[p.key]));
  const rowStates: Record<string, RowInfo> = {};
  const workingIn = workingByDir(panes, hook, running, liveIds); // STAT-036: working agents per workspace
  const cacheFor = cacheMinutes(settings); // SET-059
  for (const [dir, states] of Object.entries(byDir)) {
    const state = strongest(states);
    const prev = rowRef.current[dir];
    const cache = cacheDue(panes.filter((p) => p.cwd === dir).map((p) => ({ agent: p.agent, state: hook[p.key], since: stamp[p.key]?.at ?? 0 })), cacheFor);
    rowStates[dir] = { ...(prev && prev.state === state ? prev : { state, changed: Date.now(), pr: null }), cache, working: workingIn[dir] ?? 0 };
  }
  rowRef.current = rowStates;
  const cells = cellsOf(panes);
  const shown = cells.filter((c) => sameDir(c.panes[0].cwd, activeDir));
  const zoomed = terminals ? zoomedGroup(zoom, shown.map((c) => c.group)) : null;
  const gridCount = zoomed === null ? shown.length : 1;
  // TERM-010: the grid's column and row weights, even until a divider is dragged; a drag starts on
  // the grid's own gap, the grid takes the pointer so a release outside the window still ends it,
  // and the end is announced so panes send their program the final size once.
  const gridCols = columnsFor(gridCount, stacked[activeDir ?? ""]);
  const gridRows = rowsFor(gridCount, stacked[activeDir ?? ""]);
  const weightKey = (axis: "col" | "row") => `${activeDir ?? ""}|${axis}|${axis === "col" ? gridCols : gridRows}`;
  const weightsOf = (axis: "col" | "row") => weights[weightKey(axis)] ?? Array<number>(axis === "col" ? gridCols : gridRows).fill(1);
  // TERM-035: Equalize drops the dragged weights of this folder's grid, so every column and row is the same size again.
  // TERM-008: Equalize also tidies: every dragged size of this folder goes, whatever the pane count was when it was dragged.
  const equalizePanes = () => setWeights((w) => tidyWeights(w, activeDir ?? null));
  // TERM-016: Move to Tab folds a pane into the cell beside it; only its group changes, so the session and its run stay.
  const moveOutToTab = (key: number) => {
    const r = moveToTab(panes, key);
    if (!r) return;
    setPanes(r.panes);
    setActiveTab((m) => ({ ...m, [r.group]: key }));
    setFocused(key);
  };
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
  // TERM-029: this grid's sessions waiting on a permission or a question, in grid order.
  const waiting = stripOn(settings) ? waitingInGrid(shown.flatMap((c) => c.panes.map((p) => p.key)), Object.fromEntries(panes.map((p) => [p.key, statusOf(p)]))).map((k) => panes.find((p) => p.key === k)!) : [];
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
  const ringOf = (p: Pane) => (context[p.key] ? { percent: contextFill(context[p.key], capOn(settings)), title: meterText(meterOf(context[p.key], p.agent, plan.claude, codexOf(p.agent, p.account, accountSwitcher.active.codex, plan.codex, plan.codexBy), capOn(settings)) ?? {}) } : null);
  useCodexPaneFigures(panes, accountSwitcher.active.codex); // T-548-b: the figures of the other accounts the Codex panes run on
  const railPick = panes.find((p) => p.key === selected);
  const footer = railPick ? usageLine(railPick.seats ? markFor(railPick.agentId ?? "") : railPick.agent, plan.claude, codexOf(railPick.agent, railPick.account, accountSwitcher.active.codex, plan.codex, plan.codexBy), readsLeft(settings)) : "";
  const planLine = (p: Pane) => {
    const f = planOf(p.agent, plan.claude, codexOf(p.agent, p.account, accountSwitcher.active.codex, plan.codex, plan.codexBy));
    return f ? meterText({ plan: f }) : undefined;
  };
  // VIEW-023: a card's chip and lane; VIEW-025: an answer typed into the agent's own prompt.
  const chipFor = (p: Pane) => chipOf({ agent: agentOf(p), state: statusOf(p), running: running[p.key], stale: stale[p.key] ?? false, ...turn[p.key], since: stamp[p.key]?.at ?? 0 }, now);
  const laneOf = (p: Pane) => (p.seats || p.kind || agentOf(p) === "shell" ? "idle" : (chipFor(p)?.lane ?? "idle"));
  // T-546: the control tower reads the same chip and meter per agent pane as the Board.
  // FIX-6 (council d2 carry-over): built only when one of the things it reads changed, not on every render; `now` moves the chips on its 30 s tick.
  const towerNow = useMemo(() => panes.filter((p) => !p.kind && !p.seats && agentOf(p) !== "shell").map((p) => ({ key: p.key, agent: agentOf(p), title: tabName(p, titles), branch: p.branch, cwd: p.cwd, account: p.account ?? null, chip: chipFor(p), meter: meterOf(context[p.key], p.agent, plan.claude, codexOf(p.agent, p.account, accountSwitcher.active.codex, plan.codex, plan.codexBy), capOn(settings)), since: stamp[p.key]?.at ?? 0 })), [panes, titles, context, plan, settings, hook, guess, running, stale, turn, stamp, now, accountSwitcher.active.codex, liveIds]);
  // T-546-c: the Tower's own window shows the same seats and usage; a row clicked there opens the pane here.
  // T-548 FIX-1: the figures are worked out on account ids, then the Tower is shown the names the switcher shows.
  const towerUsage = useMemo(() => nameUsage(usageByAccount(towerNow, plan, accountSwitcher.active), (agent, id) => switcherLabel(accountSwitcher.groups, agent, id)), [towerNow, plan, accountSwitcher.active, accountSwitcher.groups]);
  const towerSeats = useMemo(() => nameSeats(towerNow, (agent, id) => switcherLabel(accountSwitcher.groups, agent, id)), [towerNow, accountSwitcher.groups]);
  useTowerBridge({ seats: towerSeats, usage: towerUsage }, openPane);
  const lanes = board ? LANES.filter((l) => cardPanes(panes).some((p) => laneOf(p) === l.id)) : [];
  const columnOf = (p: Pane) => lanes.findIndex((l) => l.id === laneOf(p)) + 1;
  // Answers, the plan sheet and review notes (editor/reviewActions.ts).
  const {
    answer, approvePlan, requestChanges, pasteInto, sendNotes, inWorktree, sendReview, startReview
  } = reviewActions(state, plumb, launchA, w);
  const reviewTargets = sendMenu ? sendTargets(panes, inWorktree, stamp, Date.now(), (p) => tabName(p, titles)) : [];
  const reviewPane = reviewing && panes.find((p) => p.key === reviewing.key);
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
  const { noticed, panesRef } = useAgentEvents({ panes, setPanes, titles, settings, inView, setToast, tabName, setCrew, setTurn, setStale, hookRef, setHook, stamp, setStamp, setContext, unreadPanes, setUnreadPanes, winFocused, markDir, muted: muteRef });
  // The late values the actions read when they run (shell/windowLate.ts), now that the window has made them.
  Object.assign(w, { pendingLineup, setupExits, cli, startSetup, projectOf, select, exitedPrompt, guard, setReveal, panesRef } satisfies WindowLate);
  useRestoredStatus({ panes, hookRef, setHook, setStale, setCrew, setTurn });
  useGone({ panes, running, hook, setHook, setTurn, setCrew }); // STAT-031 / T-275: gone agents stop reporting
  // STAT-044: a clicked notification focuses the pane that raised it (notification_clicked emits the pane).
  useEffect(() => {
    const off = listen<{ pane: string }>("notification-click", (e) => {
      const key = Number(e.payload.pane);
      if (panesRef.current.some((x) => x.key === key)) setFocused(key);
    });
    return () => {
      void off.then((f) => f());
    };
  }, [panesRef]);
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
      seatDefault={seatDefault(settings)}
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
      onCopies={(copies) => setChooser(p.key, { copies })}
      busy={launching}
      closable={chooserClosable(panesIn(panes, activeDir).length, sheetOf !== null)}
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
        needsYou={needing}
        classic={classic}
        sidebarWidth={leftWidth}
        appMenu
        uiZoom={zoomFactor()}
        onScreen={setScreen} installed={installedIds} codexAccount={codex.accounts.length > 0} onSearch={() => setPalette(true)} onBack={!stepAllowed(screen === "terminals", settingsOpen) || travel(hist, -1, stillThere) === null ? undefined : () => step(-1)} onForward={!stepAllowed(screen === "terminals", settingsOpen) || travel(hist, 1, stillThere) === null ? undefined : () => step(1)} sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((o) => !o)} onZoom={(how) => zoomTerm(focused, how)} fullPage={fullPage} rightOpen={terminals && right.open} onToggleRight={() => (terminals && right.open ? saveRight({ open: false }) : showRight(right.tab))} />
      <div className="body" style={{ "--sidebar-w": `${leftWidth}px` } as CSSProperties}>
        <AboutPanel />
        {palette && (
          <WorktreePalette
            projects={projects}
            items={paletteItems()}
            prOf={() => null} /* VIEW-043: the Pull requests rows come from prRows */
            atOf={(d) => {
              const row = Object.entries(rowStates).find(([x]) => sameDir(x, d))?.[1];
              // STAT-024: the radio mark when the folder's working panes only watch background work.
              const watching = dirMonitoring(panes.filter((p) => sameDir(p.cwd, d)).map((p) => ({ state: hook[p.key], monitoring: turn[p.key]?.monitoring })));
              const mark = dirMark(row?.state ?? null, [...unreadDirs].some((x) => sameDir(x, d)), watching);
              return mark ? { mark, since: row?.changed ?? 0 } : null;
            }}
            recent={recentDirs.current}
            scope={[]}
            hasWorktree={activeDir !== null && projectOf(activeDir) !== null}
            onWorktree={(w) => {
              noteUse("palette");
              setScreen("terminals");
              select(w.path, w.branch ?? null);
            }}
            onCreate={(name, repo) => {
              noteUse("palette");
              setScreen("terminals");
              const item = workItem(name);
              if (item) return fromItem(item);
              const pid = repo ?? projectOf(activeDir) ?? projectFor(null);
              if (pid) return fromName(pid, name);
              setSidebarOpen(true);
              setCreateName(name);
              setCreateRequest((n) => n + 1);
            }}
            onClose={() => setPalette(false)}
            linked={linkedPrs(settings[SCM_LINKED_PR_KEY])}
            hosts={pasteHosts(linkedPrs(settings[SCM_LINKED_PR_KEY]))}
            onItem={openInBrowser}
          />
        )}
        {asking && (
          <Ask
            title={asking.title}
            body={asking.body}
            confirm={asking.confirm ?? "Close tab"}
            enter
            onCancel={() => setAsking(null)}
            onConfirm={() => {
              dropPanes(asking.keys);
              setAsking(null);
            }}
          />
        )}
        <TrustPrompt />
        {/* STAT-039 (T-110-b): after the first work renamed a branch, asks before the folder follows; a moved folder's panes and the list follow it. */}
        <FolderRenameAsk
          onMoved={(from, to) => {
            setPanes((ps) => ps.map((p) => (sameDir(p.cwd, from) ? { ...p, cwd: to } : p)));
            setActiveDir((d) => (sameDir(d, from) ? to : d));
            setRefresh((n) => n + 1);
          }}
        />
        <LinkAskHost />
        <TabSearch tabs={() => paletteItems().filter((i) => i.section === "Open tabs")} />
        {guard.dialog}
        {quitAsk && (
          <Ask
            {...quitQuestion(quitAsk)}
            cancel="Keep working"
            onCancel={() => setQuitAsk(null)}
            onConfirm={() => {
              quitting.current = true;
              setQuitAsk(null);
              void getCurrentWindow().close();
            }}
          />
        )}
        {reloadAsking && (
          <Ask {...reloadAsk(reloadAsking)} cancel="Keep working" onCancel={() => setReloadAsk(null)} onConfirm={() => location.reload()} />
        )}
        {switcher && (
          <div className="menu tab-switcher" role="listbox" aria-label="Switch tab">
            {switcher.list.map((k, i) => {
              const p = panes.find((x) => x.key === k);
              return (
                <div key={k} className={`menu-item${i === switcher.at ? " on" : ""}`} role="option" aria-selected={i === switcher.at}>
                  {p ? tabName(p, titles) : `Tab ${k}`}
                </div>
              );
            })}
          </div>
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
              {/* TERM-048 / TERM-046 / TERM-049: Change Title, Pin, Tab Color and the splits head the menu (terminal/tabColor.ts tabMenuHead). */}
              {tabMenuHead(panes.find((p) => p.key === tabMenu.key)?.kind, pinned.has(tabMenu.key), splitMenuState(panes, tabMenu.key)).map((i) =>
                i.id === "color" ? (
                  <div key={i.id} className="menu-colors" role="group" aria-label={i.label}>
                    <span className="name">{i.label}</span>
                    {TAB_COLORS.map((c) => (
                      <button
                        key={c.id}
                        role="menuitemradio"
                        aria-checked={tabColors[tabMenu.key] === c.id}
                        className="swatch"
                        style={{ background: c.css }}
                        title={c.label}
                        aria-label={c.label}
                        onClick={() => (setTabMenu(null), setTabColors((m) => setTabColor(m, tabMenu.key, c.id)))}
                      />
                    ))}
                    <button role="menuitem" className="swatch none" title="No color" aria-label="No color" onClick={() => (setTabMenu(null), setTabColors((m) => setTabColor(m, tabMenu.key, null)))}>
                      ×
                    </button>
                  </div>
                ) : (
                  <button
                    key={i.id}
                    role="menuitem"
                    className="menu-item"
                    disabled={"disabled" in i ? i.disabled : false}
                    title={"why" in i && i.why ? i.why : undefined}
                    onClick={() => {
                      const key = tabMenu.key;
                      setTabMenu(null);
                      if (i.id === "rename") setRenamingTab(key);
                      else if (i.id === "splitRight" || i.id === "splitDown") splitTab(key, i.id === "splitRight" ? "right" : "down");
                      else
                        setPinned((s) => {
                          const n = new Set(s);
                          if (n.has(key)) n.delete(key);
                          else n.add(key);
                          return n;
                        });
                    }}
                  >
                    <span className="name">{i.label}</span>
                    {i.id === "rename" && <Kbd id="tab.rename" />}
                  </button>
                ),
              )}
              {(
                [
                  ["Close", "one"],
                  ["Close others", "others"],
                  ["Close to the right", "right"],
                  ["Close to the left", "left"],
                  ["Close all", "all"],
                ] as [string, Which][]
              ).map(([label, which]) => {
                const keys = bulkCloseSet(orderOf(tabMenu.key), tabMenu.key, which, pinned);
                return (
                  <button
                    key={which}
                    role="menuitem"
                    className="menu-item"
                    disabled={keys.length === 0 || (which === "one" && pinned.has(tabMenu.key))}
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
        {boardOpen && <WorkspaceBoard onClose={() => setBoardOpen(false)} />}
        {(terminals || screen === "artifacts" || screen === "skills") && sidebarOpen && (
          <ProjectsPanel
            reveal={reveal}
            openDirs={openDirs}
            sessions={sources}
            onOpenSession={openPane}
            states={rowStates}
            unread={unreadDirs}
            onUnread={markDir}
            settings={settings}
            onSetting={saveSetting}
            activeDir={activeDir}
            onSelect={select}
            onRemoved={removed}
            onRemovedAll={removedAll}
            onSleep={removedAll}
            nest={settings[NESTING_KEY] !== false}
            onNest={(on) => saveSetting(NESTING_KEY, on)}
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
            renameRequest={renameRequest}
            onRenameTaken={() => setRenameRequest(0)}
            onStartIn={startIn}
            onAdded={projectAdded}
            artifactsOn={screen === "artifacts"}
            onArtifacts={() => setScreen("artifacts")}
            skillsOn={screen === "skills"}
            onSkills={() => toggleSkills(screen, setScreen)}
            onPending={setStandIns}
            onSetup={startSetup}
            onIndex={(list, dirs, typed) => {
              setProjects(list);
              setOwner(dirs);
              setNames(typed);
            }}
          />
        )}
        {(terminals || screen === "artifacts" || screen === "skills") && sidebarOpen && (
          <Grip side="left" width={leftWidth} label="Resize the sidebar" className="lside-grip" onWidth={(w, done) => {
            setDragLeft(done ? null : clampLeft(w));
            if (done) saveSetting(LEFT_KEY, clampLeft(w));
          }} />
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
            taskOf={(k) => workerNames[`term-${ptys.current[k]}`]}
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
          <RecoveryMount />
          {terminals && page === null && <ToolNotices projects={projects.map((p) => p.id).join(",")} />}
          {terminals && reviewPane && reviewing && (
            <PlanSheet
              title={nameOf(names, reviewPane.cwd) ?? (reviewPane.cwd ? folderName(reviewPane.cwd) : tabName(reviewPane, titles))}
              plan={reviewing.plan}
              cut={reviewing.cut}
              closed={!reviewing.send && !stillPending(hook[reviewPane.key], turn[reviewPane.key], reviewing.plan)}
              sending={!!reviewing.send}
              onCancel={() => reviewing.send?.cancel()}
              draft={planDrafts[draftKey(reviewPane.key, reviewing.plan)] ?? { comments: [], note: "" }}
              onDraft={(d) => setPlanDrafts((m) => keepDraft(m, draftKey(reviewPane.key, reviewing.plan), d))}
              onApprove={() => approvePlan(reviewPane, reviewing.plan)}
              onRequest={() => void requestChanges(reviewPane, reviewing.plan)}
              onClose={() => setReviewing(null)}
            />
          )}
          {terminals && page === "automations" && (
            <AutomationsPage
              onClose={() => setPage(null)}
              liveRun={(r) => !!runPane(r)}
              onViewRun={(r) => {
                const p = runPane(r);
                if (!p) return;
                setPage(null);
                openPane(p.key);
              }}
              onResume={(r) => r.worktree && select(r.worktree, null)}
              projects={projects}
              agents={agents}
              settings={settings}
              onSettings={(built) => savePageSettings(settings, built)}
            />
          )}
          {terminals && page === "tasks" && <TasksPage repo={tasksRepo(projects, activeDir)} onStart={fromItem} onResume={(dir) => cli.current.select(dir, null, true)} />}
          {terminals && page === "routing" && (
            <RoutingPage
              agents={agents}
              settings={settings}
              onSettings={(built) => savePageSettings(settings, built)}
            />
          )}
          {terminals && (
            <>
              {page === null && <LayoutStrip count={shown.length} onLayout={setCount} agents={agents.filter((a) => a.installed)} shells={shells} onNewTab={(a) => void newTab(a)} preview={<PreviewButton dir={activeDir} onFocus={setFocused} />} />}
              {picking === "file" && activeDir && (
                <FilePicker
                  root={activeDir}
                  what="file"
                  load={() => invoke<{ files: string[]; capped: boolean; source: string; rgMissing: boolean }>("file_list", { root: activeDir }).then((l) => quickOpenList(activeDir, l))}
                  onPick={(f) => openFile(f.path)}
                  onClose={() => setPicking(null)}
                />
              )}
              {picking === "template" && activeDir && <TemplatePicker root={activeDir} onOpen={openFile} onError={(m) => setToast(m)} onClose={() => setPicking(null)} />}
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
          {screen === "skills" && <SkillsPage workspace={activeDir} onClose={() => closeSkills(setScreen)} />}
          {inbox && <InboxView items={inboxItems(inboxSeen.sources, now)} now={now} onOpen={openPane} onReview={reviewChanges} />}
          {screen === "agents" && <AgentsChat open={{ onOpenFile: (path, line, column) => openFile(path, line, column), onOpenLink: openInBrowser, inKolux: linksOpenInKolux(settings), onReview: (k, plan, cut) => setReviewing({ key: k, plan, cut }) }} taskOf={(k) => workerNames[`term-${ptys.current[k]}`]} panes={panes.filter((p) => !p.kind && !p.seats).map((p) => ({ key: p.key, cwd: p.cwd, title: p.title, program: p.program }))} focused={selected ?? focused} ptyOf={(k) => ptys.current[k]} hook={hook} stateOf={(k) => hookRef.current[k]} onPick={(key) => {
                setAgentSel(key);
                setFocused(key);
              }} />}
          {tower && <TowerView rows={towerRows(towerSeats)} usage={towerUsage} now={now} onOpen={openPane} />}
          {floor && <FloorView onOpen={openPane} />}
          {space && <SpaceView projectId={projectFor(projectOf(activeDir))} projectName={(() => { const p = projects.find((x) => x.id === projectFor(projectOf(activeDir))); return p ? projectLabel(p) : ""; })()} openDirs={openDirs} />}
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
          {terminals && page === null && waiting.length > 0 && (
            <div className="needs-strip" role="list" aria-label="Sessions that need you">
              {waiting.map((p) => (
                <button key={p.key} role="listitem" className="needs-chip" onClick={() => openPane(p.key)} title={VOCAB[statusOf(p)!].explain}>
                  <StatusGlyph glyph="attention" size={11} />
                  <span className="name">{tabName(p, titles)}</span>
                  <span className="why">{statusOf(p) === "permission" ? "needs permission" : "asked a question"}</span>
                </button>
              ))}
            </div>
          )}
          {terminals && page === null && standIns.length > 0 && (
            // PROJ-020: a stand-in tab for each workspace Git is still making; it gives way to
            // the workspace's own tabs once it opens, and never pulls focus.
            <div className="tabs standins" role="tablist" aria-label="Workspaces being created">
              {standIns.map((c) => (
                <div key={c.ticket} role="tab" aria-selected={false} aria-busy="true" className="tab standin" data-standin={c.name} title={`Git is making ${c.name}; it opens when it is ready`}>
                  <Spinner size={12} />
                  <span className="tab-name">{c.name}</span>
                  <span className="hint">creating…</span>
                </div>
              ))}
            </div>
          )}
          <div
            className={board ? "board" : agentsScreen ? "grid agents" : `grid${zoomed === null ? "" : " zoomed"}${classic ? " classic" : ""}`}
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
                  <div
                    key={c.group}
                    className="cell"
                    data-drop={dropHint?.group === c.group && !dropHint.tab ? dropHint.zone : undefined}
                    hidden={agentsScreen ? !mine : !board && (!sameDir(c.panes[0].cwd, activeDir) || (zoomed !== null && c.group !== zoomed))}
                    onDragOver={(e) => {
                      if (!dragging.current) return;
                      e.preventDefault();
                      setDropHint({ group: c.group, zone: zoneOf(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect(), !!(e.target as Element).closest?.(".tabs")) });
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHint((h) => (h?.group === c.group ? null : h));
                    }}
                    onDrop={(e) => {
                      const d = dragging.current;
                      if (!d) return;
                      e.preventDefault();
                      const zone = zoneOf(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect(), !!(e.target as Element).closest?.(".tabs"));
                      dragging.current = null;
                      setDropHint(null);
                      if ("tab" in d) dropTabOn(d.tab, { kind: "cell", group: c.group, zone });
                      else dropCellOn(d.cell, { group: c.group, zone });
                    }}
                  >
                    {(c.panes.length > 1 || classic) && (
                      <div className="tabs" role="tablist" aria-label="Tabs">
                        {orderPinnedFirst(c.panes.map((p) => p.key), pinned)
                          .map((k) => c.panes.find((p) => p.key === k) as (typeof c.panes)[number])
                          .map((p) => (
                          <div
                            key={p.key}
                            role="tab"
                            aria-selected={p.key === active}
                            className="tab"
                            tabIndex={0}
                            style={tabStyle(tabColors, p.key)}
                            data-drop={dropHint?.tab === p.key ? dropHint.half : undefined}
                            draggable
                            onDragStart={(e) => {
                              // TERM-054: a tab drags along the strip, onto another cell's strip, or onto an edge band.
                              dragging.current = { tab: p.key };
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", tabName(p, titles));
                            }}
                            onDragEnd={() => (dragging.current = null, setDropHint(null))}
                            onDragOver={(e) => {
                              const d = dragging.current;
                              if (!d || !("tab" in d)) return;
                              e.preventDefault();
                              e.stopPropagation();
                              setDropHint({ group: c.group, tab: p.key, half: halfOf(e.clientX, e.currentTarget.getBoundingClientRect()) });
                            }}
                            onDrop={(e) => {
                              const d = dragging.current;
                              if (!d || !("tab" in d)) return;
                              e.preventDefault();
                              e.stopPropagation();
                              const half = halfOf(e.clientX, e.currentTarget.getBoundingClientRect());
                              dragging.current = null;
                              setDropHint(null);
                              dropTabOn(d.tab, { kind: "tab", key: p.key, half });
                            }}
                            onMouseDown={() => setFocused(p.key)}
                            onDoubleClick={() => !p.kind && setRenamingTab(p.key)}
                            onContextMenu={(e) => {
                              // TERM-049: the tab menu opens where the pointer is; this click never closes it.
                              e.preventDefault();
                              e.stopPropagation();
                              setTabMenu({ key: p.key, top: Math.min(e.clientY, window.innerHeight - 220), left: Math.min(e.clientX, window.innerWidth - 240) });
                            }}
                            onAuxClick={(e) => {
                              // TERM-049 / TERM-046: middle-click closes the tab; a pinned tab is exempt.
                              if (e.button !== 1 || !middleClickCloses(p.key, pinned)) return;
                              e.preventDefault();
                              closePane(p.key);
                            }}
                          >
                            {pinned.has(p.key) && (
                              <span className="tab-pin" title="Pinned" data-pinned="true">
                                <Pin size={10} />
                              </span>
                            )}
                            {p.kind === "editor" || p.kind === "preview" || p.kind === "diff" || p.kind === "changes" ? <FileCode size={12} /> : p.kind === "browser" ? <Globe size={12} /> : <VendorMark agent={shownAgent(p.agent, creditedLive(launchedAgent(p), liveIds[p.key] ?? IDLE))} size={12} />}
                            {!p.kind && !p.seats && <TabBadge kind={tabBadge(p.agent, running[p.key], needsYou(statusOf(p)), unreadPanes.has(p.key), hook[p.key])} />}
                            {context[p.key] && <Ring percent={contextFill(context[p.key], capOn(settings))} size={10} title={meterText(meterOf(context[p.key], p.agent, plan.claude, codexOf(p.agent, p.account, accountSwitcher.active.codex, plan.codex, plan.codexBy), capOn(settings)) ?? {})} />}
                            {renamingTab === p.key ? (
                              <NameField value={tabName(p, titles, labelOf(p), liveIds)} label="Tab name" onSave={(name) => (setRenamingTab(null), renamePane(p.key, name))} onCancel={() => setRenamingTab(null)} />
                            ) : (
                              tabLabel(p)
                            )}
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
                  <BrowserPane
                    key={p.key}
                    id={p.key}
                    url={p.url ?? p.path}
                    title={titles[p.key]}
                    hidden={!terminals || settingsOpen || p.key !== active}
                    focused={p.key === focused}
                    onFocus={() => setFocused(p.key)}
                    onClose={() => closePane(p.key)}
                    cwd={p.cwd}
                    // BROW-037: notes go to an agent pane in the tab's own worktree, by the review-notes paste path.
                    targets={() => sendTargets(panes, (x) => x.cwd !== null && p.cwd !== null && sameDir(x.cwd, p.cwd) && ptys.current[x.key] !== undefined, stamp, Date.now(), (x) => tabName(x, titles))}
                    onSend={(key, text) => pasteInto(key, text)}
                    restored={restoredKeys.current.has(p.key)}
                  />
                ) : p.kind === "editor" && p.path ? (
                  <EditorPane
                    key={p.key}
                    id={p.key}
                    path={p.path}
                    root={p.cwd}
                    readOnly={p.follow}
                    follow={p.follow}
                    notes={notes}
                    onRemoveNote={(n) => setNotes((ns) => ns.filter((x) => x !== n))}
                    onEditNote={(n, text) => setNotes((ns) => ns.map((x) => (x === n ? { ...x, note: text } : x)))}
                    hidden={!terminals || p.key !== active}
                    focused={p.key === focused}
                    onFocus={() => setFocused(p.key)}
                    onClose={() => closePane(p.key)}
                    onDirty={(d) => setDirty((m) => (!!m[p.key] === d ? m : { ...m, [p.key]: d }))}
                    onToast={setToast}
                    jump={p.jump}
                    onLink={followLink}
                  />
                ) : p.kind === "diff" && p.path ? (
                  <DiffPane
                    key={p.key}
                    id={p.key}
                    path={p.path}
                    root={p.cwd}
                    staged={!!p.staged}
                    hidden={!terminals || p.key !== active}
                    focused={p.key === focused}
                    onFocus={() => setFocused(p.key)}
                    onClose={() => closePane(p.key)}
                    onDirty={(d) => setDirty((m) => (!!m[p.key] === d ? m : { ...m, [p.key]: d }))}
                    onToast={setToast}
                    notes={notesFor(p.cwd).filter((n) => keyOf(n.path) === keyOf(p.path ?? ""))}
                    onSaveNote={p.cwd === null ? undefined : (n) => putNote(p.cwd as string, n)}
                    onDeleteNote={(n) => p.cwd !== null && dropNotes(p.cwd, [n.id])}
                    jump={p.jump}
                  />
                ) : p.kind === "changes" && p.cwd ? (
                  <AllChangesPane key={p.key} id={p.key} root={p.cwd} hidden={!terminals || p.key !== active} focused={p.key === focused} onFocus={() => setFocused(p.key)} onClose={() => closePane(p.key)} onOpenDiff={(path, staged) => openDiff(path, staged, true)} pinnedBase={projects.find((pr) => pr.id === projectOf(p.cwd))?.base ?? null} />
                ) : p.kind === "preview" && p.path ? (
                  <PreviewPane key={p.key} id={p.key} path={p.path} worktree={p.cwd} onLink={followLink} hidden={!terminals || p.key !== active} focused={p.key === focused} onFocus={() => setFocused(p.key)} onClose={() => closePane(p.key)} />
                ) : p.seats ? (
                  renderChooser(p as Pane & { seats: Seat[] }, !board && p.key !== active, p.key === focused, () => setFocused(p.key), () => closePane(p.key))
                ) : (
                  <TerminalPane
                    key={p.key}
                    hidden={!board && p.key !== active}
                    restored={restoredKeys.current.has(p.key)}
                    resumed={p.resumed}
                    onOpenFile={openFile}
                    onOpenLink={openInBrowser}
                    linksOpenInKolux={settings.linksOpenInKolux === true}
                    gpu={gpuOn(settings)}
                    card={board ? { expanded: expanded === p.key, onToggle: () => setExpanded((x) => toggleCard(x, p.key)), chip: chipFor(p), column: columnOf(p), onAnswer: (ok) => void answer(p, ok), onReview: () => reviewChanges(p.key), meter: p.seats || p.kind ? null : meterOf(context[p.key], p.agent, plan.claude, codexOf(p.agent, p.account, accountSwitcher.active.codex, plan.codex, plan.codexBy), capOn(settings)) } : undefined}
                    cwd={p.cwd}
                    branch={p.branch}
                    agent={p.agent}
                    name={savedName(p) ?? labelOf(p)}
                    plan={agentsScreen ? planLine(p) : undefined}
                    program={p.program}
                    args={p.args}
                    env={p.env}
                    stop={turn[p.key]?.stop}
                    context={context[p.key] ? contextFill(context[p.key], capOn(settings)) : null}
                    usage={p.agent === "shell" ? undefined : readoutOf(context[p.key], capOn(settings), readsLeft(settings))}
                    focused={p.key === focused}
                    onFocus={() => {
                      setFocused(p.key);
                      runTabs.current = touchRunTab(runTabs.current, p.key);
                    }}
                    onRunning={(on) => {
                      // T-151-c: a program still starting reports undefined: no entry yet, so it never reads as ended
                      if (on === undefined) {
                        setRunning((r) => (p.key in r ? Object.fromEntries(Object.entries(r).filter(([k]) => Number(k) !== p.key)) : r));
                        return;
                      }
                      if (runRef.current[p.key] && !on && p.agent !== "shell") {
                        noticed(p, "finished");
                        setStamp((m) => ({ ...m, [p.key]: { at: Date.now(), interrupted: false } }));
                      }
                      setRunning((r) => (r[p.key] === on ? r : { ...r, [p.key]: on }));
                      // STAT-050: a pane that just started counts from now in the Inbox.
                      if (on) setStamp((m) => (m[p.key] ? m : { ...m, [p.key]: { at: Date.now(), interrupted: false } }));
                      // The program is gone: its last hook state goes with it everywhere. An open question or
                      // permission is remembered for the Inbox alone (T-035-b); a stop is not a prompt.
                      exitedPrompt.current = onRunning(exitedPrompt.current, p.key, on, hookRef.current[p.key]);
                      if (!on && p.key in hookRef.current) setHook((h) => Object.fromEntries(Object.entries(h).filter(([k]) => Number(k) !== p.key)));
                      const then = !on && runRef.current[p.key] && afterSetup.current[p.key];
                      if (then) {
                        delete afterSetup.current[p.key];
                        then();
                      }
                    }}
                    hook={hook[p.key] === "working" && turn[p.key]?.monitoring ? "background" : hook[p.key]}
                    pendingTool={hook[p.key] === "permission" ? turn[p.key]?.tool : undefined}
                    keySettings={settings}
                    crew={crew[p.key]}
                    onNeedsYou={(on) => setNeeds((r) => (r[p.key] === on ? r : { ...r, [p.key]: on }))}
                    onIdentity={(l) => {
                      // Review of PR #16: a hand-started agent quit and the prompt is back: its last word and guess go with it,
                      // and (d) a late hook word from it is ignored until a new agent starts in the pane.
                      const muted = muteRef.current[p.key] ?? false;
                      const mute = hooksMuted(muted, p, liveRef.current[p.key], l);
                      if (mute !== muted) muteRef.current = { ...muteRef.current, [p.key]: mute };
                      if (promptReturned(p, liveRef.current[p.key], l)) {
                        setHook((h) => forget(h, p.key));
                        setGuess((g) => forget(g, p.key));
                      }
                      setLiveIds((m) => (m[p.key] === l ? m : { ...m, [p.key]: l }));
                    }}
                    onGuess={(g) => setGuess((m) => (m[p.key] === g ? m : { ...m, [p.key]: g }))}
                    onBell={() => noticed(p, BELL_NOTE.what, "", BELL_NOTE.gate)}
                    unread={unreadPanes.has(p.key)}
                    onPty={(id, account) => {
                      ptys.current[p.key] = id;
                      startWatch.seen(p.key);
                      // SESS-032 (T-163): an agent's opening prompt is handed over by Rust exactly once; a
                      // prompt that does not go in is said in a toast.
                      if (p.typed && p.agent !== "shell") void deliverPrompt(invoke, id, p.typed, agents.find((a) => a.id === p.agentId)?.name ?? p.agent).then((lost) => lost && setToast(lost));
                      report.current();
                      if (p.batch !== undefined && p.agent !== "shell") rememberLineup(p.batch);
                      // T-139-d: a Codex pane on a managed account is watched for printed sign-in errors.
                      watchCodexSignIn(id, p.agent === "codex" ? account : null);
                      // ACCT-023: a Codex pane remembers the account it began on.
                      if (p.agent === "codex") {
                        const setup = codexSetup(settings); // T-139-d: and the setup it began on
                        if (p.account !== account || p.setup !== setup) setPanes((ps) => ps.map((x) => (x.key === p.key ? { ...x, account, setup } : x)));
                      }
                    }}
                    account={p.account}
                    notice={noticeFor(p)}
                    onFailed={(error) => {
                      failedPane(p.key, error);
                      const then = afterSetup.current[p.key];
                      delete afterSetup.current[p.key];
                      then?.();
                    }}
                    onSplit={(dir) => splitPane(p.key, dir)}
                    dragCell={!board && showsDragHandle(shown.length) ? { onStart: () => (dragging.current = { cell: groupOf(p) }), onEnd: () => (dragging.current = null, setDropHint(null)) } : undefined}
                    onEqualize={terminals && gridCount > 1 ? equalizePanes : undefined}
                    onMoveToTab={terminals && gridCount > 1 && moveToTab(panes, p.key) ? () => moveOutToTab(p.key) : undefined}
                    expand={board ? undefined : { on: zoomed === groupOf(p), can: canExpand(shown.length, classic), toggle: () => expandPane(p.key) }}
                    title={p.title || nameOf(names, p.cwd)}
                    custom={!!p.title}
                    onRename={(name) => renamePane(p.key, name)}
                    renameAsk={askName[p.key]}
                    sessionKnown={!!p.session}
                    session={p.session}
                    onSessionLaunch={(l, fork, forkName) => splitPane(p.key, "right", undefined, { agent: p.agent, agentId: p.agentId, account: p.account, setup: p.setup, env: p.env, program: l.program, args: l.args, forkOf: fork ? p.session : undefined, title: fork ? forkName : undefined })}
                    entryTabs={panes.filter((q) => sameDir(q.cwd, activeDir)).map((q) => ({ key: q.key, name: tabName(q, titles, labelOf(q), liveIds) }))} // TERM-042: the plus menu's entry box jumps to these
                    onEntry={(t) => (t.kind === "browser" ? openInBrowser(t.url) : t.kind === "file" ? openFile(t.path) : setFocused(t.key))}
                    shells={shells}
                    onShell={(sh) => void newTab({ shell: sh })} // TERM-043: the plus menu's shell choice, a tab like the New tab menu's // after-list #117: Continue / Fork open a second pane beside this one
                    onCopyId={(what) => copyId(p, what)}
                    findHandle={findHandle}
                    typed={p.typed}
                    shellName={p.word}
                    number={p.key}
                    onClose={() => closePane(p.key)}
                    onReviewPlan={showsReview(hook[p.key], turn[p.key]) ? () => setReviewing({ key: p.key, plan: turn[p.key]?.plan ?? "", cut: !!turn[p.key]?.planCut }) : undefined}
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
        <RightSidebar tab={right.tab} width={clampWidth(dragWidth ?? right.width, window.innerWidth, sidebarOpen ? leftWidth + 8 : 0)} hidden={!terminals || !right.open || fullPage} offered={offeredRight} onTab={(tab) => {
          const patch: Record<string, unknown> = { [RIGHT_KEYS.tab]: tab };
          if (wsKind.folder && activeDir !== null) patch[FOLDER_TAB_KEY] = rememberTab(settingsRef.current[FOLDER_TAB_KEY], activeDir, tab);
          const { was, next } = applySettings(settingsRef, patch);
          setSettings(next);
          saveChanged(was, next).catch((err) => setNotice(String(err)));
        }} onWidth={(w, done) => {
          const used = clampWidth(w, window.innerWidth, sidebarOpen ? leftWidth + 8 : 0);
          setDragWidth(done ? null : used);
          if (done) saveRight({ width: used });
        }}>
        {scmOpen && (
          <SourceControlPanel dir={activeDir} writer={writerOf(settings)} draft={activeDir === null ? "" : (drafts[activeDir] ?? "")} onDraft={(text, dir) => (dir ?? activeDir) !== null && setDrafts((d) => ({ ...d, [dir ?? activeDir!]: text }))} onClose={() => saveRight({ open: false })} onFix={fixWithAI} aiShown={aiControlsShown(settings)} pinnedBase={projects.find((p) => p.id === projectOf(activeDir))?.base ?? null} onChangeBase={(base) => {
            const p = projects.find((x) => x.id === projectOf(activeDir));
            if (p) void invoke<Project>("project_set", { projectId: p.id, workspacesDir: p.workspacesDir ?? "", base }).then((u) => setProjects((ps) => ps.map((x) => (x.id === u.id ? u : x))));
          }} againstUpstream={settings[SUMMARY_UPSTREAM_KEY] === true} groupOrder={settings[SCM_GROUP_ORDER_KEY]} view={settings[SCM_VIEW_KEY] === "tree" ? "tree" : "list"} onView={(v) => saveSetting(SCM_VIEW_KEY, v)} onOpenDiff={(path, staged) => activeDir !== null && openDiff(`${activeDir.replace(/[\\/]+$/, "")}/${path}`, staged, true)} onAllChanges={() => void newTab("changes")} diffSplit={diffSplitOf(settings[DIFF_SPLIT_KEY])} onDiffSplit={(v) => saveSetting(DIFF_SPLIT_KEY, v)} notesSection={activeDir !== null && <LineNotes dir={activeDir} notes={notesFor(activeDir)} repoless={repoless} onOpen={(n) => (noteTarget(repoless) === "file" ? openFile(n.path, n.end ?? n.line) : openDiff(n.path, n.staged, true, n.end ?? n.line, n.side))} onDrop={(ids) => dropNotes(activeDir, ids)} onClearSent={() => saveNotes(activeDir, clearDelivered(notesFor(activeDir)))} onSend={() => sendNotes(activeDir)} />} onAgainstUpstream={(on) => saveSetting(SUMMARY_UPSTREAM_KEY, on)} fixAgent={settings[SCM_AGENT_KEY]} onFixAgent={(id) => saveSetting(SCM_AGENT_KEY, id)} linkedPr={activeDir === null ? null : (linkedPrs(settings[SCM_LINKED_PR_KEY])[activeDir] ?? null)} onLinkPr={(url) => activeDir !== null && saveSetting(SCM_LINKED_PR_KEY, withLink(linkedPrs(settings[SCM_LINKED_PR_KEY]), activeDir, url))} onAgentAction={async (a, prompt) => {
            if (activeDir === null) return "Open a workspace first.";
            try {
              await openIn(a, activeDir, panesIn(panes, activeDir)[0]?.branch ?? null, prompt, true);
              return null;
            } catch (err) {
              return `${a.name} did not start, so the conflicts were not handed over: ${String(err)}`;
            }
          }} agents={menuAgents(agents, defaultId)} onHand={(a, note) => activeDir !== null && void startIn(a, activeDir, panesIn(panes, activeDir)[0]?.branch ?? null, note, true)} />
        )}
        {/* VIEW-080 (T-168, T-169): the Agents tab lists past sessions of every agent in the saved scope. */}
        {right.open && right.tab === "agents" && (
          <AgentsPanel settings={settings} onSave={saveSetting} activeDir={activeDir} projects={projects} projectDirs={Object.entries(owner).filter(([, p]) => p === projectOf(activeDir)).map(([d]) => d)} rescanKey={panes.length} visible={terminals} shell={shells[0]?.program ?? null} onResume={(s, plan) => void resumeOrFocus(s, plan)} onResumeChat={(s, plan) => void resumeIn(s.agent, plan).then((ok) => ok && setScreen(classic ? "terminals" : "agents"))} openDirs={[...new Set(panes.map((p) => p.cwd).filter((d): d is string => d !== null))]} onJump={(d) => setActiveDir(d)} />
        )}
        {right.open && right.tab === "attached" && activeDir !== null && <AttachedWorktreesTab folder={activeDir} worktrees={wsKind.worktrees} onOpen={(path) => { setScreen("terminals"); select(path, null); }} />}
        {right.open && right.tab === "prchecks" && activeDir !== null && <FolderChecksTab folder={activeDir} worktrees={wsKind.worktrees} />}
        {/* VIEW-073: the Checks tab follows the workspace of the focused terminal. */}
        {right.open && right.tab === "checks" && <ChecksPanel dir={activeDir} linked={activeDir === null ? null : (linkedPrs(settings[SCM_LINKED_PR_KEY])[activeDir] ?? null)} visible={terminals} />}
        {/* T-187-b / T-189-b: the dialog and helpers behind "Continue with…", "Fix with an agent" and "Start with an agent". */}
        <AgentStartHost
          agents={agents}
          defaultId={defaultId}
          saved={settings[SCM_AGENT_KEY]}
          workspace={activeDir}
          notify={(text, failed) => (failed ? setNotice(text) : setToast(text))}
          launch={async (id, dir, prompt, extra) => {
            const a = agents.find((x) => x.id === id);
            if (!a) throw new Error(`${id} is not installed here.`);
            await openIn(a, dir, panesIn(panes, dir)[0]?.branch ?? null, prompt, true, extra);
            return { handed: true };
          }}
          makeWorkspace={async (item) => {
            const made = await invoke<Created>("workspace_from_item", { item });
            setRefresh((n) => n + 1);
            cli.current.select(made.path, made.branch, true);
            void runSetup(made.path, made.branch);
            return made;
          }}
        />
        {activeDir ? <Explorer key={activeDir} root={activeDir} hidden={!explorerOpen} focusAsk={explorerFocus} onOpen={openFile} onClose={() => saveRight({ open: false })} onOpenTerminal={openTerminalIn} onWake={() => showRight("explorer")} /> : explorerOpen && <AddProjectRow />}
        </RightSidebar>
      </div>
      <Guides />
      {wizard !== null && (
        <Wizard
          start={wizard}
          ping={settings["notifyOnFinish" satisfies KindKey] !== false}
          onPing={(on) => saveSetting("notifyOnFinish" satisfies KindKey, on)}
          onSession={() => void wizardSession()}
          onPickFolder={() => {
            if (wizardClose.retry()) return;
            pickFolder(); // ONB-004, the same hand-over T-612's Open a session uses with no workspace
          }}
          onClose={() => {
            if (wizardClose.retry()) return;
            const none = projects.length === 0;
            endWizard("dismissed", () => (firstFolder.current = none));
          }}
        />
      )}
      <UpdateCenter />
      <BringSkillsUp onShow={() => screen !== "skills" && toggleSkills(screen, setScreen)} />
      <SkillUpdateNotice settingsLoaded={settingsRead} />
      <FeedbackDialog />
      {reviewOn(settings) && (
        <ReviewNotes
          picked={picked}
          notes={notes}
          onAdd={(n) => {
            const kept = repoless && activeDir !== null ? plainNote(n, crypto.randomUUID()) : null;
            if (kept && activeDir !== null) putNote(activeDir, kept);
            else setNotes((ns) => [...ns, n]);
            setPicked(null);
          }}
          onCancel={() => setPicked(null)}
          onRemove={(i) => setNotes((ns) => ns.filter((_, k) => k !== i))}
          onClear={() => setNotes([])}
          targets={reviewTargets}
          menu={sendMenu}
          onMenu={setSendMenu}
          onSend={sendReview}
          starters={activeDir === null ? [] : startChoices(agents, defaultId)}
          onStart={startReview}
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
        active={activeDir}
        hooks={settingsRead ? hooksOn(settings) : null}
        loaded={() => windowLoaded(settingsRead, restoredKeys.current, ptys.current, panes)}
      />
      )}
      <FloatingLayer agents={agents} defaultId={defaultId} home={activeDir ?? undefined} onToast={(m) => setToast(m)} />
      <EditMenuHost />
    </div>
  );
}
