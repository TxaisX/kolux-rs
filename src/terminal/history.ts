// TERM-106: a reopened pane shows what it printed before the restart above a fresh shell. The
// bytes come from the app's own per-pane file (terminal.rs History), a transcript of everything the
// terminal processed for that pane, the restore itself included, so a replay draws the same screen.
import { decodeOutput } from "./codec";

/** Sequences a replay must not carry: the terminal's answers to them (cursor position, device
 *  attributes, focus in/out) would be typed into the new shell as held keys. They draw nothing. */
const QUERIES = /\x1b\[[?>]?[0-9;]*[nc]|\x1b\[\?[0-9;]*\$p|\x1b\[>[0-9;]*q|\x1b\]1[0-9];\?\x07|\x1b\[\?1004h/g;

/** Back on the main screen (a program that owned the alternate screen when the app died left the
 *  pane there), cursor shown, colours reset, focus events off. */
export const RESET = "\x1b[?1049l\x1b[?25h\x1b[0m\x1b[?1004l";

/** The one-line note under the saved output. */
export const NOTE = "\x1b[90m── restored after a restart · the shell below is new ──\x1b[0m";

/** The saved output as the terminal takes it; nothing when nothing was saved. */
export function replay(saved: string): string | null {
  return saved ? new TextDecoder().decode(decodeOutput(saved)).replace(QUERIES, "") : null;
}

/** Enough of xterm's IBuffer to find the last row with text. */
export interface Rows {
  length: number;
  baseY: number;
  getLine(y: number): { translateToString(trim?: boolean): string } | undefined;
}

/** The cursor move that lands on the row under the last text on screen (scrolling when that text
 *  sits on the bottom row), or on the top row when the screen is blank. */
export function placeNote(buf: Rows, rows: number): string {
  let last = buf.length - 1;
  while (last >= 0 && !buf.getLine(last)?.translateToString(true)) last--;
  const r = last - buf.baseY;
  return r < 0 ? "\x1b[1;1H" : `\x1b[${Math.min(r, rows - 1) + 1};1H\r\n`;
}

/** What the pane writes after the saved output, before its new shell: the reset, the note under the
 *  last text, then the whole screen pushed into the scrollback with the cursor parked at the top. The
 *  pty's first frame starts at the cursor it finds (it asks), and a resize repaints from the top, so
 *  the new prompt lands right under the note either way. */
export function restoreTail(buf: Rows, rows: number): string {
  return RESET + placeNote(buf, rows) + NOTE + "\r\n".repeat(rows) + "\x1b[H";
}

/** APP-052: what follows the replay once the pane knows what it reattached to. A terminal the service
 *  kept running is the program the replay ends with, so its screen stays as drawn (pushing it up left
 *  the pane blank, as an idle shell redraws nothing); only a new shell gets `restoreTail`. */
export function afterReplay(buf: Rows, rows: number, takenBack: boolean): string {
  return takenBack ? "" : restoreTail(buf, rows);
}

/** The scrollback row to show at the top so the row the cursor is on (the new prompt) is the last
 *  one in view, with the note and the old output above it. */
export function viewTop(buf: { baseY: number }, rows: number): number {
  return Math.max(0, buf.baseY - rows + 1);
}

/** Text as the history file takes it (UTF-8, base64), so what the pane wrote goes into the transcript. */
export function encodeHistory(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

/** after-list #195 (T-119-c): title changes parsed while saved history replays belong to a program that is gone, so
 *  the pane's title handler runs only through `live`, and the replay's writes go through `during`. */
export function replayGate() {
  let depth = 0;
  return {
    live:
      <A extends unknown[]>(fn: (...a: A) => void) =>
      (...a: A) => {
        if (depth === 0) fn(...a);
      },
    async during<T>(run: () => Promise<T>): Promise<T> {
      depth++;
      try {
        return await run();
      } finally {
        depth--;
      }
    },
  };
}
