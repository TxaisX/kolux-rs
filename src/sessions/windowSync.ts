// VIEW-007 (T-168): screen and sidebar preferences stay in step across windows. Every window
// re-reads the saved settings when another one saves (the "settings-saved" event). The sleeping
// toggle and the sidebar choices are plain settings, so they follow by themselves; the screen is
// window state, so this decides when a saved screen may move the window: never off a page the user
// is on.
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** The screen another window saved, when this window should follow it: a known screen, different
 * from the current one, and no page (Tasks, Automations, ...) open in this window. */
export function syncedScreen<S extends string>(saved: unknown, current: S, page: unknown, valid: readonly S[]): S | null {
  if (page !== null && page !== undefined) return null;
  return typeof saved === "string" && saved !== current && (valid as readonly string[]).includes(saved) ? (saved as S) : null;
}

type Args<S extends string> = {
  field: string;
  valid: readonly S[];
  screen: S;
  page: unknown;
  /** Called with the screen to show; the caller marks it as already saved so it is not written back. */
  onScreen: (s: S) => void;
  /** False until the window has read its own settings once, so the first read never counts as a sync. */
  ready: boolean;
};

/** Follows other windows' saved screen. Listens for the settings event and reads the settings itself. */
export function useWindowSync<S extends string>({ field, valid, screen, page, onScreen, ready }: Args<S>) {
  const now = useRef({ screen, page, ready, onScreen, valid, field });
  now.current = { screen, page, ready, onScreen, valid, field };
  useEffect(() => {
    const off = listen("settings-saved", () => {
      const c = now.current;
      if (!c.ready) return;
      void invoke<Record<string, unknown>>("get_settings")
        .then((s) => {
          const next = syncedScreen(s[c.field], now.current.screen, now.current.page, c.valid);
          if (next !== null) c.onScreen(next);
        })
        .catch(() => {});
    });
    return () => void off.then((u) => u()).catch(() => {});
  }, []);
}
