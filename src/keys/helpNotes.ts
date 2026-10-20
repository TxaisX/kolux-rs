// SET-019 / SET-015 (T-246-b): the notes the Shortcuts help shows about layouts. Plain sentences, per platform.
import type { Platform } from "./actions";

/** Why interface zoom keys may need rebinding on a keyboard that types characters with AltGr. */
export const ALTGR_ZOOM_NOTE =
  "On keyboards that type characters with AltGr (German, Polish and others), the interface zoom chords Ctrl+Alt+- and Ctrl+Alt+0 type a character instead, so Kolux ignores them. Rebind Zoom Interface Out and Reset Interface Zoom to chords your layout does not type.";

/** Ctrl+= / Ctrl+- / Ctrl+0 belong to the terminal, not the interface. */
export const TERMINAL_ZOOM_NOTE = "Ctrl+= , Ctrl+- and Ctrl+0 zoom the terminal pane that has focus; the whole interface has its own zoom keys.";

/** Tab and workspace keys follow the physical key, so non-US layouts still work. */
export const LAYOUT_NOTE = "Digit and bracket shortcuts follow the physical key, so a non-US keyboard uses the same positions.";

/** The layout notes for this platform, in the order the page shows them. */
export function layoutNotes(platform: Platform): string[] {
  return platform === "darwin" ? [TERMINAL_ZOOM_NOTE, LAYOUT_NOTE] : [TERMINAL_ZOOM_NOTE, ALTGR_ZOOM_NOTE, LAYOUT_NOTE];
}
