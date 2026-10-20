// ACCT-060: when the program in a pane ends, the terminal modes it turned on are turned off again,
// so the shell that follows (or the next agent) starts from a normal terminal: a click no longer
// prints mouse escape codes, a paste is no longer bracketed by a program that is gone, the cursor is
// visible again. The sequences are written INTO xterm (the program is gone, the terminal's own state
// is what needs resetting), never to the PTY. A program still running is never touched: the reset
// runs only on its exit, and an agent restarted afterwards hides its cursor again itself.
// Sequences: ECMA-48 CSI with the DEC private parameter (xterm ctlseqs "DECRST"): CSI ? Pm l.

/** The slice of xterm's `IModes` this reset reads (any object with these fields works, so tests need no xterm). */
export type ModeView = {
  mouseTrackingMode: "none" | "x10" | "vt200" | "drag" | "any";
  bracketedPasteMode: boolean;
  sendFocusMode: boolean;
  applicationCursorKeysMode: boolean;
  applicationKeypadMode: boolean;
  synchronizedOutputMode: boolean;
};

const CSI = "\x1b[";
const off = (...modes: number[]) => modes.map((m) => `${CSI}?${m}l`).join("");

/**
 * The bytes to write into the terminal once its program has exited, `altScreen` being whether the
 * alternate screen buffer is the active one at that moment. Only what the program left on is turned
 * off; the cursor is always shown again (xterm keeps no public getter for DECTCEM).
 */
export function resetAfterExit(modes: ModeView, altScreen: boolean): string {
  let out = "";
  // first back to the main screen, so what the pane prints next (the exit line) lands where the shell draws
  if (altScreen) out += off(1049);
  // a program that died in the middle of a synchronized update would otherwise leave the screen frozen
  if (modes.synchronizedOutputMode) out += off(2026);
  // every mouse protocol and encoding: x10 (9), vt200 (1000), drag (1002), any-motion (1003); utf8 / SGR / urxvt encodings
  if (modes.mouseTrackingMode !== "none") out += off(9, 1000, 1002, 1003, 1005, 1006, 1015);
  if (modes.sendFocusMode) out += off(1004);
  if (modes.bracketedPasteMode) out += off(2004);
  if (modes.applicationCursorKeysMode) out += off(1);
  if (modes.applicationKeypadMode) out += off(66);
  // cursor visible (DECTCEM on), always
  out += `${CSI}?25h`;
  return out;
}

/** The mode fields xterm exposes, read defensively: a disposed terminal yields the all-off view. */
export function modeView(modes: Partial<ModeView> | undefined): ModeView {
  return {
    mouseTrackingMode: modes?.mouseTrackingMode ?? "none",
    bracketedPasteMode: modes?.bracketedPasteMode ?? false,
    sendFocusMode: modes?.sendFocusMode ?? false,
    applicationCursorKeysMode: modes?.applicationCursorKeysMode ?? false,
    applicationKeypadMode: modes?.applicationKeypadMode ?? false,
    synchronizedOutputMode: modes?.synchronizedOutputMode ?? false,
  };
}
