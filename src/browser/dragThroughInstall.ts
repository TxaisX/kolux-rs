// BROW-052 / T-319-c: imported once by BrowserPane so the window's drags are watched from start-up
// (a page made in the middle of a drag then still lets it through). See dragThrough.ts.
import { invoke } from "@tauri-apps/api/core";
import { installDragThrough } from "./dragThrough";

if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
  installDragThrough(window, (on) => {
    invoke("browser_drag_through", { on }).catch(() => {});
  });
}
