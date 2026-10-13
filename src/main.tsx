import React from "react";
import { saveChanged } from "./settings/saveChanged";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { applyAppearance, cachedAppearance, followSystemMode, readAppearance } from "./theme";
import { stampLook } from "./settings/general";
import { applyLanguage, LANGUAGE_FIELD } from "./language";
import { LAYOUT_FIELD, restoreLayout, resumeArgs, stillThere } from "./terminal/layout";
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
  // SET-017: the saved language is in force before the first frame draws.
  applyLanguage(saved?.[LANGUAGE_FIELD]);
  // SET-037: the look is written down on the first start, so a fresh profile stays New.
  const stamped = saved && stampLook(saved);
  if (stamped) void saveChanged(saved, stamped).catch(() => {});
  // PROJ-067: the saved tabs come back, less those whose folder is gone.
  let layout = restoreLayout((stamped || saved || {})[LAYOUT_FIELD]);
  if (layout) {
    const dirs = [...new Set([...layout.panes.map((p) => p.cwd), layout.activeDir].filter((d): d is string => d !== null))];
    const kinds = await Promise.all(dirs.map((d) => invoke<string>("path_kind", { path: d }).catch(() => "missing")));
    layout = stillThere(layout, (d) => kinds[dirs.indexOf(d)] !== "missing");
    // SESS-030: an agent tab starts again on its standing start line (permission mode, the user's own
    // arguments and environment) plus its own resume command; an agent no longer known keeps the bare line.
    for (const p of layout.panes) {
      if (p.agent === "shell" || p.kind || !p.agentId) continue;
      const line = await invoke<{ args: string[]; program: string | null; env: [string, string][] }>("agent_start_line", { id: p.agentId, extra: resumeArgs(p.agent, p.session), prompt: "" }).catch(() => null);
      if (line) Object.assign(p, { args: line.args, program: line.program ?? p.program, env: line.env });
    }
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App initial={stamped || saved || {}} layout={layout} />
    </React.StrictMode>,
  );
  requestAnimationFrame(() => requestAnimationFrame(() => void getCurrentWindow().show().catch(() => {})));
}

void start();
