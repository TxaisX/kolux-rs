// PROJ-054: getting around a long sidebar. After a strong upward flick a scroll-to-top button shows
// (never for a short list or near the top) and fades when idle; revealing the current workspace
// clears whatever filters were hiding it; a workspace made active scrolls its row into view, waiting
// for the row to be drawn if it is not there yet.

/** A flick is strong when it moves at least this many pixels per second upward. */
export const FLICK_SPEED = 1500;
/** The list must be at least this many viewports tall before the button can show. */
export const LONG_LIST = 2.5;
/** The button needs the list scrolled at least this many viewports down. */
export const FAR_DOWN = 1;
/** The button fades away after this long without scrolling. */
export const IDLE_MS = 1800;

/** Wheel or touch movement: `deltaY` negative is upward, over `ms` milliseconds. */
export function strongUpwardFlick(deltaY: number, ms: number): boolean {
  return deltaY < 0 && ms > 0 && (-deltaY / ms) * 1000 >= FLICK_SPEED;
}

export type Scroll = { scrollTop: number; scrollHeight: number; clientHeight: number };

/** Whether the scroll-to-top button may show at all: a list that is long and scrolled well down. */
export function topButtonAllowed(s: Scroll): boolean {
  if (s.clientHeight <= 0) return false;
  return s.scrollHeight >= s.clientHeight * LONG_LIST && s.scrollTop >= s.clientHeight * FAR_DOWN;
}

export type TopButton = { shown: boolean; idleSince: number };

/** The button after a scroll event: a strong upward flick shows it (when allowed); any other scroll keeps what it was; a list that no longer allows it hides it. */
export function nextTopButton(prev: TopButton, s: Scroll, flick: boolean, now: number): TopButton {
  if (!topButtonAllowed(s)) return { shown: false, idleSince: now };
  if (flick) return { shown: true, idleSince: now };
  return prev;
}

/** A tick with no scroll: fades the button once it has been idle long enough. */
export const fadeIfIdle = (prev: TopButton, now: number): TopButton => (prev.shown && now - prev.idleSince >= IDLE_MS ? { shown: false, idleSince: now } : prev);

export type Filter = { key: string; hides: (path: string) => boolean };

/** The filters hiding the workspace at `path`: revealing it turns exactly these off. */
export function filtersToClear(path: string | null, filters: Filter[]): string[] {
  if (path === null) return [];
  return filters.filter((f) => f.hides(path)).map((f) => f.key);
}

/** Looks for a row until it is drawn (every `every` ms, `tries` times) and scrolls it into view once; false if it never appeared. */
export async function whenRowDrawn<T>(find: () => T | null, show: (row: T) => void, wait: (ms: number) => Promise<void>, tries = 20, every = 50): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const row = find();
    if (row !== null) {
      show(row);
      return true;
    }
    await wait(every);
  }
  return false;
}
