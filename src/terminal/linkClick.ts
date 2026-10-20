// TERM-092 (T-222-c): a click meant as a link is not forwarded to a program that tracks the mouse.
// xterm sends every unshifted press to such a program (vim, tmux, an agent UI); the link modifier
// click on a link under the pointer belongs to Kolux, so TerminalPane takes it before xterm does.

/** The pieces of a press this decision reads. */
export type Press = { button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean };

/** Whether Kolux keeps this press for the link under the pointer: the primary button with the link
 *  modifier (Cmd on macOS, Ctrl elsewhere), while a program tracks the mouse. Shift is left alone:
 *  xterm never forwards a shifted press, and Linkifier opens the link itself. With no tracking
 *  program nothing is claimed, so xterm's own link handling and selection run as they always did. */
export function claimsClick(e: Press, mac: boolean, tracking: string): boolean {
  return tracking !== "none" && e.button === 0 && !e.shiftKey && (mac ? e.metaKey : e.ctrlKey);
}
