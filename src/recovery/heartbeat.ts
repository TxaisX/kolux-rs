// APP-042: the page's heartbeat to the watch in recovery.rs, which reloads a page that sends none for 20 s.
// RecoveryMount beats for App; the crash screen (ScreenBoundary, which replaces App) beats while a report is written.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HEARTBEAT_MS } from "./model";

/** Tells the watch the page is alive: at once, then every two seconds while mounted. */
export function useHeartbeat(): void {
  useEffect(() => {
    const beat = () => void invoke("ui_heartbeat").catch(() => {});
    beat();
    const t = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, []);
}

/** The heartbeat as an element, for a class component (ScreenBoundary) that cannot call the hook. */
export function Heartbeat(): null {
  useHeartbeat();
  return null;
}
