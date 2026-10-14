import React from "react";
import { saveChanged } from "./settings/saveChanged";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { applyAppearance, cachedAppearance, followSystemMode, readAppearance } from "./theme";
import { stampLook } from "./settings/general";
import { applyLanguage, LANGUAGE_FIELD } from "./language";
import { applyZoom, ZOOM_FIELD } from "./settings/zoom";
import { followText } from "./terminal/text";
import { installMenuWheel } from "./settings/menuWheel";
import { LAYOUT_FIELD, restoreAsks, restoreLayout, stillThere } from "./terminal/layout";
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
  // SET-037 / T-418: the look and a missing mode are written down on the first start (New, Dark),
  // and only from settings really read: after the timeout (`saved` null) nothing is written.
  const stamped = saved && stampLook(saved);
  if (stamped) void saveChanged(saved, stamped).catch(() => {});
  if (saved) applyAppearance(readAppearance(stamped || saved));
  // SET-017: the saved language is in force before the first frame draws.
  applyLanguage(saved?.[LANGUAGE_FIELD]);
  // SET-019: and so is the saved interface zoom.
  applyZoom(saved?.[ZOOM_FIELD]);
  // SET-022 / SET-025: terminals open with the saved text settings and follow every save.
  followText(saved);
  // PROJ-067: the saved tabs come back, less those whose folder is gone. VIEW-107 (T-069-b): App is
  // told whether the settings answered, so a slow start saves no layout over the saved tabs.
  let layout = restoreLayout((stamped || saved || {})[LAYOUT_FIELD]);
  if (layout) {
    const dirs = [...new Set([...layout.panes.map((p) => p.cwd), layout.activeDir].filter((d): d is string => d !== null))];
    const kinds = await Promise.all(dirs.map((d) => invoke<string>("path_kind", { path: d }).catch(() => "missing")));
    layout = stillThere(layout, (d) => kinds[dirs.indexOf(d)] !== "missing");
    // TERM-106: the saved output of tabs no longer in the layout is cleaned up in the background.
    void invoke("terminal_prune_history", { keep: layout.panes.map((p) => p.key) }).catch(() => {});
    // SESS-030: an agent tab starts again on its standing start line (permission mode, the user's own
    // arguments and environment) plus its own resume command, built on the Rust side from the tab's
    // last session id (every catalogue agent, not only Claude Code and Codex); `resumed` drives the
    // TERM-107 mark. An agent no longer known keeps the bare line. restoreAsks skips plain shells.
    for (const p of layout.panes) {
      if (!restoreAsks(p)) continue;
      const line = await invoke<{ args: string[]; program: string | null; env: [string, string][]; resumed: boolean }>("agent_start_line", { id: p.agentId, extra: [], prompt: "", restore: true, session: p.session ?? null }).catch(() => null);
      if (line) Object.assign(p, { args: line.args, program: line.program ?? p.program, env: line.env, resumed: line.resumed });
      else p.resumed = false;
    }
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App initial={stamped || saved || {}} layout={layout} read={saved !== null} />
    </React.StrictMode>,
  );
  requestAnimationFrame(() => requestAnimationFrame(() => void getCurrentWindow().show().catch(() => {})));
}

installMenuWheel(document);
void start();
