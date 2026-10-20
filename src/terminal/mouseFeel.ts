// T-307-b: how the mouse feels in a terminal pane. Pure apart from the callbacks it is handed.
// TERM-089: inside a full-screen program (the alternate screen, or any program that takes the mouse) xterm sends one
// wheel report (or one arrow key) per wheel event whatever its size, so the full-screen scroll setting never scaled
// anything and a fast burst queued up in the program. Here every whole wheel notch becomes `perTick` reports (times the
// fast multiplier with Ctrl or Alt), the first notch goes out at once, and the rest of a burst is sent at most once per
// frame, capped, with the excess dropped instead of queued, so scrolling stops soon after the wheel does.
// TERM-088: a drag in a program that takes the mouse goes to the program; the pane says once that Shift selects.
// TERM-091: a pane hidden by a tab switch comes back at the row it showed (or still at the bottom if it was there).

/** Pixels Chromium reports for one notch of a wheel (WheelEvent deltaMode 0), and lines for one in line mode. */
export const NOTCH_PX = 100;
export const NOTCH_LINES = 3;

export type WheelIn = { deltaMode: number; deltaY: number; ctrlKey: boolean; altKey: boolean };

/** Turns wheel events into a bounded number of reports. `send(dir, n)`: n reports, dir 1 down / -1 up. */
export class WheelDrain {
  private carry = 0;
  private pending = 0;
  private cap = 1;
  private waiting = false;
  constructor(
    private send: (dir: 1 | -1, n: number) => void,
    private frame: (f: () => void) => void,
  ) {}

  push(e: WheelIn, perTick: number, fast: number, rows: number): void {
    const units = e.deltaMode === 1 ? e.deltaY / NOTCH_LINES : e.deltaMode === 2 ? (e.deltaY * rows) / NOTCH_LINES : e.deltaY / NOTCH_PX;
    if (units === 0) return;
    // a turn the other way drops what was still owed the old way
    if (units * this.carry < 0) this.carry = 0;
    if (units * this.pending < 0) this.pending = 0;
    this.carry += units;
    const whole = Math.trunc(this.carry);
    if (whole === 0) return; // a trackpad's small steps add up to a notch first
    this.carry -= whole;
    const each = Math.max(1, perTick) * (e.ctrlKey || e.altKey ? Math.max(1, fast) : 1);
    this.pending += whole * each;
    this.cap = Math.max(1, Math.round(2 * each));
    if (!this.waiting) this.flush();
  }

  private flush(): void {
    const n = Math.min(Math.round(Math.abs(this.pending)), this.cap);
    const dir: 1 | -1 = this.pending < 0 ? -1 : 1;
    this.pending = 0; // the rest of a burst is dropped, never queued
    if (n === 0) {
      this.waiting = false;
      return;
    }
    this.waiting = true;
    this.send(dir, n);
    this.frame(() => this.flush());
  }
}

/** TERM-088: the words shown (once) when a plain drag goes to a program that takes the mouse. */
export const SHIFT_HINT = "This program uses the mouse. Hold Shift while you drag to select text.";

/** Whether a drag of (dx, dy) pixels with the left button should bring the Shift hint up. */
export const dragWantsHint = (mouseMode: string, shift: boolean, dx: number, dy: number): boolean => mouseMode !== "none" && !shift && Math.hypot(dx, dy) >= 5;

/** TERM-091: where a pane shown again scrolls to: the bottom, or the row its kept marker sits on now. */
export type KeptView = { bottom: boolean; line: number | null };
export function shownAgain(kept: KeptView, baseY: number): "bottom" | number | null {
  if (kept.bottom) return "bottom";
  if (kept.line === null || kept.line < 0) return null; // the row was trimmed from the scrollback meanwhile
  return Math.min(kept.line, baseY);
}
