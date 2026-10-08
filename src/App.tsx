import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { windowTitle, type AppInfo } from "./app-info";

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    invoke<AppInfo>("app_info").then(setInfo).catch(() => setInfo(null));
  }, []);
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24, color: "#e6e6e6", background: "#1f2a44", minHeight: "100vh", boxSizing: "border-box" }}>
      <h1 style={{ margin: 0, fontSize: 20 }}>{windowTitle(info)}</h1>
      <p style={{ opacity: 0.8 }}>
        {info ? `Profile folder: ${info.profileDir} · start number ${info.startCount}` : "Waiting for the Rust side…"}
      </p>
    </main>
  );
}
