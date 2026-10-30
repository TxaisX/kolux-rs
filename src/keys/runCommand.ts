// T-611: a command picked in the palette runs through the same code its shortcut runs. A stand-in keydown
// goes to the element that has the keyboard, as the chord would, and matchEvent (keymap.ts) answers that one
// event with the command, so the window's key switch, a pane's or the editor's handles it as it handles the
// chord, and an unbound command runs too. ponytail: a stand-in key event, not a command registry; the
// upgrade path is a registry the key listeners call as well, once the window's key switch leaves App.tsx.

type Pending = { event: object; id: string; index?: number };
let pending: Pending | null = null;

/** The command a stand-in key event carries; null for every real key press. */
export const commandOf = (e: object): Pending | null => (pending !== null && pending.event === e ? pending : null);

/** True while a command picked in the palette runs: the terminal never holds it (terminalPolicy.ts). */
export const runningCommand = (): boolean => pending !== null;

type Where = { later?: (f: () => void) => void; target?: EventTarget; event?: () => Event };

/** Runs command `id` (with its digit for the two 1 to 9 commands) once the palette has closed and given the
 *  keyboard back to where it was opened from. */
export function runCommand(id: string, index?: number, where: Where = {}): void {
  const later = where.later ?? ((f: () => void) => void setTimeout(f, 0));
  later(() => {
    const target = where.target ?? document.activeElement ?? document.body;
    const event = where.event?.() ?? new KeyboardEvent("keydown", { key: "Unidentified", bubbles: true, cancelable: true });
    pending = { event, id, index };
    try {
      target.dispatchEvent(event);
    } finally {
      pending = null;
    }
  });
}
