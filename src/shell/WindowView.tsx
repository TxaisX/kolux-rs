// The window's drawing, moved out of App.tsx as it was (cycle 2, the App.tsx split): the top bar, the dialogs and
// menus, the sidebar and the Agents rail, the screens and pages, the pane grid with its tabs and panes, the right
// sidebar, and the window-wide hosts. A plain function the window calls last in its render, with everything that
// render made (shell/windowBag.ts), so the element tree is the one App.tsx returned.
import type { Pane } from "../App";
import type { WindowBag } from "./windowBag";
import AgentsRail from "../agents/AgentsRail";
import { cardPanes, rowStatus } from "../agents/rail";
import { touchRunTab } from "../automations/runTab";
import { forget, hooksMuted, needsYou, promptReturned } from "../board/chip";
import { openInBrowser } from "../browser/openIn";
import { linksOpenInKolux } from "../chat/chatLinks";
import Ask from "../chrome/Ask";
import LayoutStrip from "../chrome/LayoutStrip";
import RightSidebar, { Grip, LEFT_KEY, RIGHT_KEYS, clampLeft, clampWidth } from "../chrome/RightSidebar";
import StatusBar from "../chrome/StatusBar";
import Tip from "../chrome/Tip";
import TopBar from "../chrome/TopBar";
import VendorMark from "../chrome/VendorMark";
import { chromeShown } from "../chrome/chromeItems";
import { FileCode, Globe, Pin, Spinner, StatusGlyph } from "../chrome/icons";
import { FIELDS as STATUS_FIELDS, readStatusBar, toggleItem } from "../chrome/statusItems";
import EditMenuHost from "../editmenu/EditMenuHost";
import FilePicker, { quickOpenList, type Pick } from "../editor/FilePicker";
import { keyOf } from "../editor/buffers";
import { clearDelivered } from "../editor/diffNotes";
import { noteTarget, plainNote } from "../editor/fileNotes";
import { reviewOn, sendTargets, startChoices } from "../editor/notes";
import FloatingLayer from "../floating/FloatingLayer";
import { onRunning } from "../inbox/exitedPrompt";
import { inboxItems } from "../inbox/inbox";
import { Kbd } from "../keys/KeymapContext";
import { reloadAsk } from "../keys/commands";
import { AllChangesPane, BrowserPane, DiffPane, EditorPane, PreviewPane } from "../lazy/panes";
import {
  AboutPanel, AddProjectRow, AgentStartHost, AgentsChat, AgentsPanel, ArtifactsPage, AutomationsPage, ChecksPanel, ChooserPane, Explorer,
  FeedbackDialog, FloorView, FolderRenameAsk, Guides, InboxView, KeyLostNotice, LineNotes, LinkAskHost, PlanSheet, PreviewButton,
  RecoveryMount, ReviewNotes, RoutingPage, SettingsPage, SignInNotice, SkillUpdateNotice, SkillsPage, SourceControlPanel, SpaceView,
  TasksPage, TemplatePicker, ToolNotices, TowerView, TrustPrompt, UpdateCenter, Wizard, WorkspaceBoard,
} from "../lazy/pages";
import { allSwitchedOff, menuAgents } from "../launch/agents";
import { chooserClosable } from "../launch/chooserClosable";
import { seatDefault } from "../launch/defaultSeat";
import { SAVED_SHAPES_KEY, applyLineup, defaultCopies, offeredLineup, restoreShape, type SavedShape, type Seat } from "../launch/seats";
import { deliverPrompt, startWatch } from "../launch/startWatch";
import { noteUse } from "../onboarding/features";
import { hooksOn } from "../onboarding/hooksOn";
import { AttachedWorktreesTab, FolderChecksTab } from "../projects/AttachedTabs.tsx";
import ProjectsPanel from "../projects/ProjectsPanel";
import WorktreePalette, { dirMark, dirMonitoring } from "../projects/WorktreePalette";
import { NESTING_KEY, folderName, projectLabel, type Created, type Project, workItem } from "../projects/model";
import { stepAllowed, travel } from "../projects/nav";
import { applySettings } from "../projects/settingWrite";
import { writerOf } from "../scm/generate";
import { SCM_AGENT_KEY, SCM_GROUP_ORDER_KEY, SCM_LINKED_PR_KEY, SCM_VIEW_KEY, SUMMARY_UPSTREAM_KEY, linkedPrs, withLink } from "../scm/model";
import { aiControlsShown } from "../scm/rules";
import { DIFF_SPLIT_KEY, diffSplitOf } from "../scm/split";
import { FOLDER_TAB_KEY, rememberTab } from "../sessions/folderTabs";
import { watchCodexSignIn } from "../settings/codexSignInScan";
import type { KindKey } from "../settings/notifications";
import { openSettings } from "../settings/pages";
import { saveChanged } from "../settings/saveChanged";
import { zoomFactor } from "../settings/zoom";
import { BringSkillsUp } from "../skills/SkillBarItem";
import { closeSkills, toggleSkills } from "../skills/nav";
import { creditedLive, launchedAgent } from "../status/credit";
import { windowLoaded } from "../status/manage";
import { tasksRepo } from "../tasks/model";
import { pasteHosts } from "../tasks/pasteHosts";
import NameField from "../terminal/NameField";
import TerminalPane from "../terminal/TerminalPane";
import { codexSetup } from "../terminal/accountChange";
import { BELL_NOTE } from "../terminal/bellNote";
import { templateOf } from "../terminal/dividers";
import { canExpand, groupOf, toggleCard } from "../terminal/grid";
import { readoutOf } from "../terminal/headerUsage";
import { bulkCloseSet, middleClickCloses, orderPinnedFirst } from "../terminal/pin";
import { draftKey, keepDraft, showsReview, stillPending } from "../terminal/planReview";
import { halfOf, showsDragHandle, zoneOf } from "../terminal/rearrange";
import { gpuOn } from "../terminal/renderer";
import { IDLE, shownAgent } from "../terminal/shellMarks";
import { VOCAB } from "../terminal/status";
import type { Which } from "../terminal/tabClose";
import { TAB_COLORS, setTabColor, tabMenuHead, tabStyle } from "../terminal/tabColor";
import { TabBadge, tabName } from "../terminal/tabName";
import { splitMenuState } from "../terminal/tabSplit";
import { tabBadge } from "../terminal/tabs";
import { zoomTerm } from "../theme";
import { towerRows } from "../tower/tower";
import Ring from "../usage/Ring";
import { capOn, codexOf, contextFill, meterOf, meterText, readsLeft } from "../usage/meter";
import { nameOf, panesIn, sameDir } from "../workspaces";
import TabSearch from "./TabSearch";
import { quitQuestion } from "./closeAsk";
import { moveToTab } from "./tidy";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CSSProperties } from "react";

export function windowView(w: WindowBag) {
  const {
    accountSwitcher, activeDir, activeOf, addChooser, addPreset, addShell, afterSetup, agentPass, agents, agentsScreen, allAgents, answer, approvePlan,
    askName, asking, board, boardOpen, cells, chipFor, classic, cli, closePane, closeTab, codex, columnOf, context, copyId, createName, createRequest, crew,
    defaultId, deleteRequest, dirty, drafts, dragWidth, dragging, dropCellOn, dropHint, dropNotes, dropPanes, dropTabOn, endDividerDrag, endWizard,
    equalizePanes, exitedPrompt, expandPane, expanded, explorerFocus, explorerOpen, failedPane, findHandle, firstFolder, fixWithAI, floor, focused, followLink,
    footer, fromItem, fromName, fullPage, gridCount, groups, guard, hist, hook, hookRef, inGitFor, inbox, inboxSeen, installedIds, keymapNotice, labelOf,
    lanes, launch, launching, leftWidth, lineupsOf, live, liveIds, liveRef, markDir, moveOutToTab, muteRef, names, needing, newTab, notes, notesFor, notice,
    noticeFor, noticed, now, offeredRight, onDividerDown, onDividerMove, openDiff, openDirs, openFile, openIn, openPane, openTerminalIn, orderOf, owner, page,
    palette, paletteItems, panes, pasteInto, pickFolder, picked, picking, pinned, plan, planDrafts, planLine, projectAdded, projectFor, projectOf, projects,
    ptys, putNote, quitAsk, quitting, recentDirs, refresh, refreshAgents, reloadAsking, rememberLineup, removed, removedAll, renamePane, renameRequest,
    renamingTab, repoless, report, requestChanges, restoredKeys, resumeIn, resumeOrFocus, reveal, reviewChanges, reviewPane, reviewTargets, reviewing, right,
    ringOf, rowStates, runPane, runRef, runSetup, runTabs, running, saveNotes, savePageSettings, saveRight, saveSetting, saved, savedName, scmOpen, screen,
    select, selected, sendMenu, sendNotes, sendReview, setActiveDir, setAgentSel, setAsking, setBoardOpen, setChooser, setCount, setCreateName,
    setCreateRequest, setDefault, setDirty, setDrafts, setDragLeft, setDragWidth, setDropHint, setExpanded, setFocused, setGuess, setHook, setLiveIds,
    setNames, setNeeds, setNotes, setNotice, setOwner, setPage, setPalette, setPanes, setPicked, setPicking, setPinned, setPlanDrafts, setProjects, setQuitAsk,
    setRefresh, setReloadAsk, setRenameRequest, setRenamingTab, setReviewing, setRunning, setScreen, setSeats, setSendMenu, setSettings, setSettingsOpen,
    setSheet, setSidebarOpen, setStamp, setStandIns, setTabColors, setTabMenu, setToast, settings, settingsAt, settingsOpen, settingsRead, settingsRef, sheet,
    shells, showRight, shown, sidebarOpen, sources, space, splitPane, splitTab, stamp, standIns, startIn, startReview, startSeats, startSetup, statusOf, step,
    stillThere, switcher, tabColors, tabLabel, tabMenu, terminals, titles, toast, tower, towerSeats, towerUsage, turn, unreadDirs, unreadPanes, waiting,
    weightsOf, wizard, wizardClose, wizardSession, workerNames, wsKind, zoomed
  } = w;
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
