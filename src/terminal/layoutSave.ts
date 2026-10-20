// T-075 (APP-048): the tabs and layout are written down as they change, but a burst of changes (a
// split, three tabs opened, the focus moved) becomes one write a moment later instead of one write
// each, and quitting flushes whatever is pending at once (APP-050). A layout equal to the last one
// written is not written again.

import type { SavedLayout } from "./layout";

export type LayoutWriter = {
  /** The layout as it is now; written after `ms` of quiet. */
  set(l: SavedLayout): void;
  /** Writes what is pending right away (the quit path). A no-op when nothing is pending. */
  flush(): void;
  /** Whether a write is waiting. */
  pending(): boolean;
};

type Timers = { set: (f: () => void, ms: number) => unknown; clear: (t: unknown) => void };
const real: Timers = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };

export function layoutWriter(write: (l: SavedLayout) => void, ms = 400, timers: Timers = real): LayoutWriter {
  let timer: unknown = null;
  let waiting: SavedLayout | null = null;
  let last = "";
  const flush = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
    const l = waiting;
    waiting = null;
    if (l === null) return;
    const text = JSON.stringify(l);
    if (text === last) return;
    last = text;
    write(l);
  };
  return {
    set(l) {
      waiting = l;
      if (timer !== null) timers.clear(timer);
      timer = timers.set(flush, ms);
    },
    flush,
    pending: () => waiting !== null,
  };
}
