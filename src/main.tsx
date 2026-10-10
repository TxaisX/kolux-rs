import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { applyAppearance, cachedAppearance, readAppearance } from "./theme";
import "./styles.css";

// SET-004: the window starts hidden (tauri.conf.json). The saved look goes on the root first, read
// from the settings (the last run's copy if they take too long), then the page draws, and only then
// is the window shown, so its first visible frame already has the saved colours and font.
async function start() {
  applyAppearance(cachedAppearance());
  const saved = await Promise.race([
    invoke<Record<string, unknown>>("get_settings").catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), 1500)),
  ]);
  if (saved) applyAppearance(readAppearance(saved));
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  requestAnimationFrame(() => requestAnimationFrame(() => void getCurrentWindow().show().catch(() => {})));
}

void start();
