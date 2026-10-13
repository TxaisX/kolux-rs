import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { applyAppearance, cachedAppearance, followSystemMode, readAppearance } from "./theme";
import { stampLook } from "./settings/general";
import "./styles.css";

// SET-004: the window starts hidden (tauri.conf.json). The saved look goes on the root first, read
// from the settings (the last run's copy if they take too long), then the page draws, and only then
// is the window shown, so its first visible frame already has the saved colours and font.
async function start() {
  applyAppearance(cachedAppearance());
  followSystemMode();
  const saved = await Promise.race([
    invoke<Record<string, unknown>>("get_settings").catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), 1500)),
  ]);
  if (saved) applyAppearance(readAppearance(saved));
  // SET-037: the look is written down on the first start, so a fresh profile stays New.
  const stamped = saved && stampLook(saved);
  if (stamped) void invoke("save_settings", { value: stamped }).catch(() => {});
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App initial={stamped || saved || {}} />
    </React.StrictMode>,
  );
  requestAnimationFrame(() => requestAnimationFrame(() => void getCurrentWindow().show().catch(() => {})));
}

void start();
