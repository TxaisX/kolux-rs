// The window: top bar, then the sidebar card beside the content column (layout strip over the
// pane grid), then the status bar. Agents and Board are empty screens for now; Terminals holds
// the pane list and the sidebar. The list starts with one PowerShell pane (T-002); the plus
// menu adds an agent pane in a fresh creature-named workspace (T-004). Panes share the grid
// evenly for now; the real 1/2/4/6 layouts come with T-009.
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
import type { Project, Worktree } from "./projects/model";

export type ShellTarget = { dir: string | null; branch: string | null };

type Pane = { key: number; cwd: string | null; branch: string | null; agent: Agent; program: string | null; args: string[] };

/** Columns for a pane count: 1, side by side for 2, two rows for 3-4, then three across. */
export function columnsFor(count: number): number {
  return count <= 1 ? 1 : count <= 4 ? 2 : 3;
}

const sameDir = (a: string, b: string) => a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [screen, setScreen] = useState<Screen>("terminals");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [layout, setLayout] = useState<Layout>(1);
  const [panes, setPanes] = useState<Pane[]>([{ key: 1, cwd: null, branch: null, agent: "shell", program: null, args: [] }]);
  const [focused, setFocused] = useState(1);
  const [running, setRunning] = useState<Record<number, boolean>>({});
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [owner, setOwner] = useState<Record<string, string>>({});
  const [refresh, setRefresh] = useState(0);
  const [launching, setLaunching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const nextKey = useRef(2);

  useEffect(() => {
    invoke<AppInfo>("app_info").then(setInfo).catch(() => setInfo(null));
    invoke<AgentInfo[]>("agent_list").then(setAgents).catch(() => setAgents([]));
  }, []);
  useEffect(() => {
    document.title = windowTitle(info);
  }, [info]);

  // T-003: Shell on a workspace row restarts the first plain-shell pane in that folder, or adds one.
  const openShell = (dir: string, branch: string | null) => {
    const key = nextKey.current++;
    setPanes((ps) => {
      const fresh: Pane = { key, cwd: dir, branch, agent: "shell", program: null, args: [] };
      const i = ps.findIndex((p) => p.agent === "shell");
      if (i < 0) return [...ps, fresh];
      const next = [...ps];
      next[i] = fresh;
      return next;
    });
    setFocused(key);
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
    setFocused((f) => (f === key ? (panes.find((p) => p.key !== key)?.key ?? f) : f));
  };

  const terminals = screen === "terminals";
  const live = panes.filter((p) => running[p.key]);
  const openDirs = panes.map((p) => p.cwd).filter((d): d is string => d !== null);
  return (
    <div className="app">
      <TopBar screen={screen} onScreen={setScreen} sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((o) => !o)} />
      <div className="body">
        {terminals && sidebarOpen && (
          <ProjectsPanel
            openDirs={openDirs}
            onOpenShell={openShell}
            agents={agents}
            launching={launching}
            onLaunch={launch}
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
              <div className="grid" style={{ gridTemplateColumns: `repeat(${columnsFor(panes.length)}, minmax(0, 1fr))` }}>
                {panes.map((p) => (
                  <TerminalPane
                    key={p.key}
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
                    launching={launching}
                    onLaunch={(a) => launch(a, null)}
                  />
                ))}
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
