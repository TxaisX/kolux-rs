// T-543: the window's passing chrome state, moved out of App.tsx as it was: the worktree palette's
// open flag, the notice line and the toast that clears itself.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { MenuBarState } from "./chromeItems";

export function useChrome() {
  const [palette, setPalette] = useState(false); // PROJ-057 / VIEW-037: the worktree palette is open
  const [notice, setNotice] = useState<string | null>(null);
  // A toast is a passing note (SESS-024 "starting 3 sessions"); it clears itself.
  const [toast, setToastText] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const setToast = (text: string) => {
    setToastText(text);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastText(null), 4000);
  };
  return { palette, setPalette, notice, setNotice, toast, setToast };
}

/** APP-009 / T-248-a: keeps the native menu bar a picture of `state` (rebuilt only when it changes)
 *  and hands every menu click the page carries out to `onAction` with the item id. */
export function useMenuBar(state: MenuBarState, onAction: (id: string) => void) {
  const act = useRef(onAction);
  act.current = onAction;
  const key = JSON.stringify(state);
  useEffect(() => {
    invoke("menu_sync", { state: JSON.parse(key) }).catch(() => {}); // a menu that fails to build leaves the last one
  }, [key]);
  useEffect(() => {
    const off = listen<{ id: string }>("menu-action", (e) => act.current(e.payload.id));
    return () => void off.then((f) => f());
  }, []);
}

/** APP-009: opens the app menu at (x, y) in the window's own pixels (Windows and Linux, where the
 *  frameless window has no native bar to draw it in). */
export function popAppMenu(x: number, y: number) {
  invoke("menu_popup", { x, y }).catch(() => {});
}
