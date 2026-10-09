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
// a child web view laid over its body by the back end (T-012-a, src/browser/BrowserPane.tsx).
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { windowTitle, type AppInfo } from "./app-info";
import TopBar, { screens, type Screen } from "./chrome/TopBar";
import LayoutStrip, { type NewTab } from "./chrome/LayoutStrip";
import BrowserPane from "./browser/BrowserPane";
import { cellsOf, clampCount, columnsFor, groupOf, insertBefore, MAX_PANES, neighbourTab, resizePlan, rowsFor, splitIndex, toggleCard } from "./terminal/grid";
import StatusBar from "./chrome/StatusBar";
import VendorMark, { type Agent } from "./chrome/VendorMark";
import TerminalPane from "./terminal/TerminalPane";
import ProjectsPanel from "./projects/ProjectsPanel";
import { markFor, programWord, type AgentInfo } from "./launch/PlusMenu";
import { DEFAULT_AGENT_KEY, defaultAgentId } from "./launch/agents";
import ChooserPane from "./launch/ChooserPane";
import { clearMissing, emptySeat, modelArgs, TERMINAL, withoutFailed, type Seat } from "./launch/seats";
import { folderName, type Project, type Worktree } from "./projects/model";
import { activeAfterRemove, focusIn, panesIn, sameDir, withoutDir } from "./workspaces";
import { KeymapProvider, useKeymap } from "./keys/KeymapContext";
import { matchEvent } from "./keys/keymap";

export type ShellTarget = { dir: string | null; branch: string | null };

/** A pane with `seats` is a chooser (SESS-007): nothing runs in it until Start. */
type Pane = { key: number; cwd: string | null; branch: string | null; agent: Agent; program: string | null; args: string[]; seats?: Seat[]; title?: string; batch?: number; typed?: string; group?: number; kind?: "browser" };

/** What a tab is called: the seat's title, the agent, the browser page's title, or "Terminal N". */
function tabName(p: Pane, titles: Record<number, string>): string {
  if (p.kind === "browser") return titles[p.key] || "New Tab";
  return p.title || (p.agent !== "shell" ? programWord(p.agent) : `Terminal ${p.key}`);
}
/** SESS-051: a seat's start line as the back end builds it. */
type StartLine = { args: string[]; typed: string | null };

/** Columns for a pane count: 1, side by side for 2, two rows for 3-4, then three across. */
export default function App() {
  return (
    <KeymapProvider>
      <Window />
    </KeymapProvider>
  );
}

/** The next screen in the Agents / Board / Terminals cycle. */
export function nextScreen(s: Screen): Screen {
  return screens[(screens.findIndex((x) => x.id === s) + 1) % screens.length].id;
}

function Window() {
  const keymap = useKeymap();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [screen, setScreen] = useState<Screen>("terminals");
  const [expanded, setExpanded] = useState<number | null>(null); // VIEW-026: the Board card showing its terminal
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
  const [titles, setTitles] = useState<Record<number, string>>({}); // browser tabs' page titles
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const defaultId = defaultAgentId(settings);
  const installedIds = agents.filter((a) => a.installed).map((a) => a.id);
  const [projects, setProjects] = useState<Project[]>([]);
  const [owner, setOwner] = useState<Record<string, string>>({});
  const [refresh, setRefresh] = useState(0);
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
    invoke<AgentInfo[]>("agent_list").then(setAgents).catch(() => setAgents([]));
    invoke<Record<string, unknown>>("get_settings").then(setSettings).catch(() => setSettings({}));
  }, []);

  // SESS-004: the default agent is a settings key; the plus menu lists it first.
  const setDefault = (id: string) => {
    const next = { ...settings, [DEFAULT_AGENT_KEY]: id };
    setSettings(next);
    invoke("save_settings", { value: next }).catch((err) => setNotice(String(err)));
  };
  useEffect(() => {
    document.title = windowTitle(info);
  }, [info]);
  // BROW-001: a browser tab is named after its page.
  useEffect(() => {
    const off = listen<{ id: number; title: string }>("browser-title", (e) => setTitles((t) => ({ ...t, [e.payload.id]: e.payload.title })));
    return () => void off.then((u) => u());
  }, []);

  // T-005: the shortcuts file is read at start; what it got wrong is said once, in the notice.
  useEffect(() => {
    if (keymap.errors.length) setNotice(keymap.errors.join(" "));
  }, [keymap]);

  // Global-scope shortcuts are pressed here, wherever focus is (the terminal policy comes with
  // SET-014). Only actions that exist today do something; the rest are matched and left alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const hit = matchEvent(keymap, e, screen === "terminals" ? ["global", "terminal", "tabs"] : ["global"]);
      if (!hit) return;
      const inFront = panesIn(panes, activeDir).some((p) => p.key === focused);
      switch (hit.id) {
        case "sidebar.left.toggle":
          setSidebarOpen((o) => !o);
          break;
        case "view.cycleWorkspaceView":
          setScreen((s) => nextScreen(s));
          break;
        case "tab.newTerminal":
          void newTab(null);
          break;
        case "tab.newBrowser":
          void newTab("browser");
          break;
        case "tab.newAgent": {
          const a = agents.find((x) => x.id === defaultId && x.installed);
          if (!a) setNotice(`The default agent (${defaultId}) is not installed.`);
          else void newTab(a);
          break;
        }
        case "tab.close":
        case "terminal.closePane":
          if (!inFront) return;
          closePane(focused);
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
      const line = a ? await invoke<StartLine>("agent_start_line", { id: a.id, extra: [], prompt: "" }) : null;
      const pane: Pane = a && line ? { ...base, agent: markFor(a.id), program: a.program, args: line.args, typed: line.typed ?? undefined } : { ...base, agent: "shell", program: null, args: [] };
      setPanes((ps) => [...ps, pane]);
      setFocused(key);
    } catch (err) {
      setNotice(String(err));
    }
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

  // Start replaces the chooser with one pane per seat (SESS-013). Agent seats run in the chooser's
  // workspace; when the chooser sits outside any workspace they get one fresh worktree together,
  // so the seats land side by side in the grid.
  const startSeats = async (key: number, seats: Seat[]) => {
    const chooser = panes.find((p) => p.key === key);
    if (!chooser) return;
    setLaunching(true);
    try {
      let dir = chooser.cwd;
      let branch = chooser.branch;
      const picked = seats.map((s) => (s.agent === TERMINAL ? null : agents.find((a) => a.id === s.agent && a.installed) ?? null));
      const missing = seats.find((s, i) => s.agent !== TERMINAL && !picked[i]);
      if (missing) throw new Error(`${missing.agent} is not installed.`);
      if (dir === null && picked.some((a) => a !== null)) {
        const pid = projectFor(null);
        if (!pid) throw new Error("Add a project first: an agent needs a repository to work in.");
        const wt = await invoke<Worktree>("workspace_create_fresh", { projectId: pid });
        dir = wt.path;
        branch = wt.branch;
      }
      const batch = key;
      // SESS-051: each agent's start line comes from the catalogue, prompt route included; a
      // refused line (Hermes past its limit) stops the whole Start before any pane is made.
      const lines = await Promise.all(picked.map((a, i) => (a ? invoke<StartLine>("agent_start_line", { id: a.id, extra: modelArgs(seats[i].model), prompt: seats[i].prompt ?? "" }) : null)));
      const made: Pane[] = seats.map((s, i) => {
        const a = picked[i];
        const line = lines[i];
        const k = nextKey.current++;
        const title = s.title?.trim() || undefined;
        return a && line
          ? { key: k, cwd: dir, branch, agent: markFor(a.id), program: a.program, args: line.args, title, batch, typed: line.typed ?? undefined }
          : { key: k, cwd: dir, branch, agent: "shell", program: null, args: [], title, batch };
      });
      setPanes((ps) => ps.flatMap((p) => (p.key === key ? made : [p])));
      setToast(made.length === 1 ? "Starting 1 session" : `Starting ${made.length} sessions`);
      setActiveDir(dir);
      setFocused(made[0].key);
      setRefresh((n) => n + 1);
      setNotice(null);
    } catch (err) {
      setNotice(String(err));
    } finally {
      setLaunching(false);
    }
  };

  // PROJ-066: a click on a workspace row shows that workspace on the same click. Its panes were
  // kept while hidden, so they come back as they were; a workspace with no pane yet gets a shell.
  const select = (dir: string, branch: string | null) => {
    setActiveDir(dir);
    if (panesIn(panes, dir).length > 0) setFocused((f) => focusIn(panes, dir, f));
    else addShell(dir, branch);
  };

  // PROJ-066: removing a workspace closes every pane in it, wherever it was; the view stays
  // unless it was the one removed, then it falls back to the home group.
  const removed = (path: string) => {
    const left = withoutDir(panes, path);
    const next = activeAfterRemove(activeDir, path);
    setPanes(left);
    setActiveDir(next);
    setFocused((f) => focusIn(left, next, f));
  };

  // Which project a launch belongs to: the one asked for, else the one that owns the focused
  // pane's folder, else the first in the list.
  const projectFor = (projectId: string | null): string | null => {
    if (projectId) return projectId;
    const cwd = panes.find((p) => p.key === focused)?.cwd;
    if (cwd) {
      const hit = Object.entries(owner).find(([dir]) => sameDir(dir, cwd));
      if (hit) return hit[1];
    }
    return projects[0]?.id ?? null;
  };

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

  const closePane = (key: number) => {
    setPanes((ps) => ps.filter((p) => p.key !== key));
    setRunning((r) => {
      const { [key]: _gone, ...rest } = r;
      return rest;
    });
    const gone = panes.find((p) => p.key === key);
    const rest = panes.filter((p) => p.key !== key);
    const next = gone ? neighbourTab(rest.filter((p) => groupOf(p) === groupOf(gone)).map((p) => p.key).concat(key), key) : null;
    setFocused((f) => (f === key ? (next ?? focusIn(rest, activeDir, f)) : f));
  };

  const terminals = screen === "terminals";
  const board = screen === "board";
  const live = panes.filter((p) => running[p.key]);
  const openDirs = panes.map((p) => p.cwd).filter((d): d is string => d !== null);
  const cells = cellsOf(panes);
  const shown = cells.filter((c) => sameDir(c.panes[0].cwd, activeDir));
  return (
    <div className="app">
      <TopBar screen={screen} onScreen={setScreen} sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((o) => !o)} />
      <div className="body">
        {terminals && sidebarOpen && (
          <ProjectsPanel
            openDirs={openDirs}
            activeDir={activeDir}
            onSelect={select}
            onRemoved={removed}
            agents={agents}
            defaultId={defaultId}
            onSetDefault={setDefault}
            launching={launching}
            onLaunch={launch}
            onChoose={addChooser}
            refresh={refresh}
            onIndex={(list, dirs) => {
              setProjects(list);
              setOwner(dirs);
            }}
          />
        )}
        <div className="content">
          {terminals && (
            <>
              <LayoutStrip count={shown.length} onLayout={setCount} agents={agents.filter((a) => a.installed)} onNewTab={(a) => void newTab(a)} />
              {toast && (
                <div className="toast" role="status">
                  {toast}
                </div>
              )}
              {notice && (
                <div className="notice" role="alert">
                  {notice}
                  <button className="ib" onClick={() => setNotice(null)} title="Dismiss">
                    ×
                  </button>
                </div>
              )}
            </>
          )}
          {!terminals && !board && (
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
            hidden={!terminals && !board}
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
                const active = c.panes.some((p) => p.key === activeTab[c.group]) ? activeTab[c.group] : c.panes[c.panes.length - 1].key;
                return (
                  <div key={c.group} className="cell" hidden={!board && !sameDir(c.panes[0].cwd, activeDir)}>
                    {c.panes.length > 1 && (
                      <div className="tabs" role="tablist" aria-label="Tabs">
                        {c.panes.map((p) => (
                          <div key={p.key} role="tab" aria-selected={p.key === active} className="tab" tabIndex={0} onMouseDown={() => setFocused(p.key)}>
                            <VendorMark agent={p.agent} size={12} />
                            <span className="tab-name">{tabName(p, titles)}</span>
                            <button className="tab-x" aria-label={`Close ${tabName(p, titles)}`} onMouseDown={(e) => e.stopPropagation()} onClick={() => closePane(p.key)}>
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {c.panes.map((p) =>
                p.kind === "browser" ? (
                  <BrowserPane key={p.key} id={p.key} title={titles[p.key]} hidden={!terminals || p.key !== active} focused={p.key === focused} onFocus={() => setFocused(p.key)} onClose={() => closePane(p.key)} />
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
                    onStart={(s) => void startSeats(p.key, s)}
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
                    focused={p.key === focused}
                    onFocus={() => setFocused(p.key)}
                    onRunning={(on) => setRunning((r) => (r[p.key] === on ? r : { ...r, [p.key]: on }))}
                    onFailed={(error) => failedPane(p.key, error)}
                    onSplit={() => splitPane(p.key, "right")}
                    title={p.title}
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
      </div>
      <StatusBar terminals={live.length} agents={live.filter((p) => p.agent !== "shell").length} />
    </div>
  );
}
