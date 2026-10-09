// The window: top bar, then the sidebar card beside the content column (layout strip over the
// pane grid), then the status bar. Agents and Board are empty screens for now; Terminals holds
// the pane list and the sidebar. The list starts with one PowerShell pane (T-002); the plus
// menu adds an agent pane in a fresh creature-named workspace (T-004). The grid shows one
// workspace at a time; the other workspaces' panes stay mounted but hidden, so switching back
// finds every terminal as it was (T-006). Panes share the grid evenly for now; the real 1/2/4/6
// layouts come with T-009.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { windowTitle, type AppInfo } from "./app-info";
import TopBar, { screens, type Screen } from "./chrome/TopBar";
import LayoutStrip, { type Layout } from "./chrome/LayoutStrip";
import StatusBar from "./chrome/StatusBar";
import type { Agent } from "./chrome/VendorMark";
import TerminalPane from "./terminal/TerminalPane";
import ProjectsPanel from "./projects/ProjectsPanel";
import { markFor, type AgentInfo } from "./launch/PlusMenu";
import { DEFAULT_AGENT_KEY, defaultAgentId } from "./launch/agents";
import ChooserPane from "./launch/ChooserPane";
import { emptySeat, modelArgs, TERMINAL, type Seat } from "./launch/seats";
import { folderName, type Project, type Worktree } from "./projects/model";
import { activeAfterRemove, focusIn, panesIn, sameDir, withoutDir } from "./workspaces";
import { KeymapProvider, useKeymap } from "./keys/KeymapContext";
import { matchEvent } from "./keys/keymap";

export type ShellTarget = { dir: string | null; branch: string | null };

/** A pane with `seats` is a chooser (SESS-007): nothing runs in it until Start. */
type Pane = { key: number; cwd: string | null; branch: string | null; agent: Agent; program: string | null; args: string[]; seats?: Seat[] };

/** Columns for a pane count: 1, side by side for 2, two rows for 3-4, then three across. */
export function columnsFor(count: number): number {
  return count <= 1 ? 1 : count <= 4 ? 2 : 3;
}

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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [layout, setLayout] = useState<Layout>(1);
  const [panes, setPanes] = useState<Pane[]>([{ key: 1, cwd: null, branch: null, agent: "shell", program: null, args: [] }]);
  const [focused, setFocused] = useState(1);
  // The workspace the grid shows; null is the home group (panes opened in no workspace).
  const [activeDir, setActiveDir] = useState<string | null>(null);
  const [running, setRunning] = useState<Record<number, boolean>>({});
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const defaultId = defaultAgentId(settings);
  const [projects, setProjects] = useState<Project[]>([]);
  const [owner, setOwner] = useState<Record<string, string>>({});
  const [refresh, setRefresh] = useState(0);
  const [launching, setLaunching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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

  // T-005: the shortcuts file is read at start; what it got wrong is said once, in the notice.
  useEffect(() => {
    if (keymap.errors.length) setNotice(keymap.errors.join(" "));
  }, [keymap]);

  // Global-scope shortcuts are pressed here, wherever focus is (the terminal policy comes with
  // SET-014). Only actions that exist today do something; the rest are matched and left alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const hit = matchEvent(keymap, e, ["global"]);
      if (!hit) return;
      switch (hit.id) {
        case "sidebar.left.toggle":
          setSidebarOpen((o) => !o);
          break;
        case "view.cycleWorkspaceView":
          setScreen((s) => nextScreen(s));
          break;
        case "tab.newAgent": {
          const a = agents.find((x) => x.id === defaultId && x.installed);
          if (!a) setNotice(`The default agent (${defaultId}) is not installed.`);
          else void launch(a, null);
          break;
        }
        default:
          return;
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
      const made: Pane[] = seats.map((s, i) => {
        const a = picked[i];
        const k = nextKey.current++;
        return a ? { key: k, cwd: dir, branch, agent: markFor(a.id), program: a.program, args: [...a.args, ...modelArgs(s.model)] } : { key: k, cwd: dir, branch, agent: "shell", program: null, args: [] };
      });
      setPanes((ps) => ps.flatMap((p) => (p.key === key ? made : [p])));
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

  // Closing a pane ends its program (the pane's own cleanup kills it); the last pane stays and
  // shows "Ended" so the grid is never empty.
  const closePane = (key: number) => {
    setPanes((ps) => (ps.length > 1 ? ps.filter((p) => p.key !== key) : ps));
    setRunning((r) => {
      const { [key]: _gone, ...rest } = r;
      return rest;
    });
    setFocused((f) => (f === key ? focusIn(panes.filter((p) => p.key !== key), activeDir, f) : f));
  };

  const terminals = screen === "terminals";
  const live = panes.filter((p) => running[p.key]);
  const openDirs = panes.map((p) => p.cwd).filter((d): d is string => d !== null);
  const shown = panesIn(panes, activeDir);
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
          {terminals ? (
            <>
              <LayoutStrip layout={layout} onLayout={setLayout} />
              {notice && (
                <div className="notice" role="alert">
                  {notice}
                  <button className="ib" onClick={() => setNotice(null)} title="Dismiss">
                    ×
                  </button>
                </div>
              )}
              <div className="grid" style={{ gridTemplateColumns: `repeat(${columnsFor(shown.length)}, minmax(0, 1fr))` }}>
                {shown.length === 0 && (
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
                {panes.map((p) =>
                  p.seats ? (
                    <ChooserPane
                      key={p.key}
                      number={p.key}
                      hidden={!sameDir(p.cwd, activeDir)}
                      focused={p.key === focused}
                      onFocus={() => setFocused(p.key)}
                      agents={agents.filter((a) => a.installed)}
                      seats={p.seats}
                      onSeats={(s) => setSeats(p.key, s)}
                      onStart={(s) => void startSeats(p.key, s)}
                      busy={launching}
                      closable={shown.length > 1}
                      onClose={() => closePane(p.key)}
                    />
                  ) : (
                    <TerminalPane
                      key={p.key}
                      hidden={!sameDir(p.cwd, activeDir)}
                      cwd={p.cwd}
                      branch={p.branch}
                      agent={p.agent}
                      program={p.program}
                      args={p.args}
                      focused={p.key === focused}
                      onFocus={() => setFocused(p.key)}
                      onRunning={(on) => setRunning((r) => (r[p.key] === on ? r : { ...r, [p.key]: on }))}
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
            </>
          ) : (
            <div className="empty">
              <h2>{screens.find((s) => s.id === screen)?.label}</h2>
              <p>Nothing here yet. This screen is built in a later task.</p>
            </div>
          )}
        </div>
      </div>
      <StatusBar terminals={live.length} agents={live.filter((p) => p.agent !== "shell").length} />
    </div>
  );
}
