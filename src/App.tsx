// The window: top bar, then the sidebar card beside the content column (layout strip over the
// pane grid), then the status bar. Agents and Board are empty screens for now; Terminals holds
// the one pane from T-002 and the sidebar from T-003.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { windowTitle, type AppInfo } from "./app-info";
import TopBar, { screens, type Screen } from "./chrome/TopBar";
import LayoutStrip, { type Layout } from "./chrome/LayoutStrip";
import StatusBar from "./chrome/StatusBar";
import TerminalPane from "./terminal/TerminalPane";
import ProjectsPanel from "./projects/ProjectsPanel";

export type ShellTarget = { dir: string | null; branch: string | null };

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [screen, setScreen] = useState<Screen>("terminals");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [layout, setLayout] = useState<Layout>(1);
  // Which folder the terminal pane starts in; a new value restarts the pane there.
  const [shell, setShell] = useState<ShellTarget & { n: number }>({ dir: null, branch: null, n: 0 });
  const [running, setRunning] = useState(0);

  useEffect(() => {
    invoke<AppInfo>("app_info").then(setInfo).catch(() => setInfo(null));
  }, []);
  useEffect(() => {
    document.title = windowTitle(info);
  }, [info]);

  const terminals = screen === "terminals";
  return (
    <div className="app">
      <TopBar screen={screen} onScreen={setScreen} sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((o) => !o)} />
      <div className="body">
        {terminals && sidebarOpen && <ProjectsPanel activeDir={shell.dir} onOpenShell={(dir, branch) => setShell((s) => ({ dir, branch, n: s.n + 1 }))} />}
        <div className="content">
          {terminals ? (
            <>
              <LayoutStrip layout={layout} onLayout={setLayout} />
              <div className="grid">
                <TerminalPane key={shell.n} cwd={shell.dir} branch={shell.branch} focused onRunning={(on) => setRunning(on ? 1 : 0)} />
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
      <StatusBar terminals={running} />
    </div>
  );
}
