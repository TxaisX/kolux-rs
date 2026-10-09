import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { windowTitle, type AppInfo } from "./app-info";
import TerminalPane from "./terminal/TerminalPane";

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    invoke<AppInfo>("app_info").then(setInfo).catch(() => setInfo(null));
  }, []);
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", color: "#e6e6e6", background: "#1f2a44", height: "100vh", display: "flex", flexDirection: "column", boxSizing: "border-box" }}>
      <h1 style={{ margin: 0, padding: "8px 12px", fontSize: 16 }}>{windowTitle(info)}</h1>
      <div style={{ flex: 1, minHeight: 0 }}>
        <TerminalPane />
      </div>
    </main>
  );
}
