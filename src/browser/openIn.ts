// BROW-001 / BROW-005: an address the app shows in a browser tab, and the event that asks the window's
// browser pane for it. Kept apart from BrowserPane.tsx, which draws the whole page bar and its menus,
// so the panes, the checks list and the shortcut router can ask for a page without carrying the browser
// pane into the first frame (cycle 3, first load). No DOM beyond the one window event.

/** The window event that opens an address in a browser tab (shell/WindowView.tsx listens for it). */
export const OPEN_IN_BROWSER = "kolux-open-in-browser";

export type OpenInBrowser = string | { url: string; title: string };

/** Asks the window to show `url` in a browser tab; `title` names the tab until the page gives its own. */
export const openInBrowser = (url: string, title?: string) => window.dispatchEvent(new CustomEvent<OpenInBrowser>(OPEN_IN_BROWSER, { detail: title === undefined ? url : { url, title } }));

/** The address and title of an `OpenInBrowser`, whichever shape was sent. */
export const openDetail = (d: OpenInBrowser): { url: string; title?: string } => (typeof d === "string" ? { url: d } : d);
