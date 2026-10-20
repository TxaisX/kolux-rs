// VIEW-106: the About panel's rows. Safe Graphics Mode comes ahead of the browser engine's own GPU status, and a status that is
// not known yet reads "unavailable".
export type AboutFacts = {
  version: string;
  /** True when this launch runs in safe graphics (no hardware acceleration); null until known. */
  safeGraphics: boolean | null;
  /** The browser engine's GPU status from the WebGL probe; null until known. */
  gpu: { webgl2: boolean; software: boolean } | null;
};

export type AboutRow = { label: string; value: string };

export const UNAVAILABLE = "unavailable";

export function gpuText(g: AboutFacts["gpu"]): string {
  if (!g) return UNAVAILABLE;
  if (!g.webgl2) return "no hardware drawing (WebGL 2 is not available)";
  return g.software ? "software drawing" : "hardware accelerated";
}

export function aboutRows(f: AboutFacts): AboutRow[] {
  return [
    { label: "Version", value: f.version || UNAVAILABLE },
    { label: "Safe Graphics Mode", value: f.safeGraphics === null ? UNAVAILABLE : f.safeGraphics ? "on (hardware acceleration is off)" : "off" },
    { label: "Graphics (browser engine)", value: gpuText(f.gpu) },
  ];
}

/** Window event that opens the panel (the Help menu item and the page both send it). */
export const ABOUT_EVENT = "kolux-about";

/** The Help > About menu item (src-tauri menu.rs sends this id to the page). */
export const ABOUT_MENU_ID = "help.about";

/** Opens the About panel; the menu item calls it. */
export function openAbout(target: EventTarget = window): void {
  target.dispatchEvent(new Event(ABOUT_EVENT));
}
