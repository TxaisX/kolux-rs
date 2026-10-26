// T-125-b / TERM-118: what a terminal bell raises. The window's note path (App's `noticed`) takes the
// bell as its own kind (the "A terminal rings its bell" switch, the `bell` notification kind and
// tray_ping("bell")); passing no switch would raise it as a finish note.

export const BELL_NOTE = { what: "rang the bell", gate: "notifyBell" } as const;

/** One bell per `gapMs` per pane: a program that rings in a loop (cat of a binary file) raises one note, not hundreds. */
export function bellGate(gapMs = 2000, now: () => number = Date.now): () => boolean {
  let last = -Infinity;
  return () => {
    const t = now();
    if (t - last < gapMs) return false;
    last = t;
    return true;
  };
}
