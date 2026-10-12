// PROJ-055 / VIEW-046: moving between workspaces by keyboard, and the back / forward history.
// PROJ-057 / VIEW-037: the worktree palette's word matching. Pure, so the rules are tested alone.

export type NavHow = { step: 1 | -1 } | { index: number };

/** Which row a keyboard move lands on, given `count` visible rows and the selected one (`at`, -1 for
 * none): next and previous wrap at either end, a number picks that position (1-based). */
export function navTarget(count: number, at: number, how: NavHow): number | null {
  if (count === 0) return null;
  if ("index" in how) return how.index >= 1 && how.index <= count ? how.index - 1 : null;
  if (at < 0) return how.step > 0 ? 0 : count - 1;
  return (at + how.step + count) % count;
}

/** A place the window has shown: a workspace folder and the sidebar page over it. */
export type Place = { dir: string | null; page: string | null };
export type History = { list: Place[]; at: number };
export const EMPTY_HISTORY: History = { list: [], at: -1 };
const HISTORY_CAP = 50;

const samePlace = (a: Place, b: Place) => (a.dir ?? "").replace(/[\\/]+$/, "").toLowerCase() === (b.dir ?? "").replace(/[\\/]+$/, "").toLowerCase() && a.page === b.page;

/** A visit: a place already in the history is kept once, at its newest visit; anything ahead of
 * the current point is dropped, as a browser does. */
export function visit(h: History, p: Place): History {
  if (h.at >= 0 && samePlace(h.list[h.at], p)) return h;
  const list = [...h.list.slice(0, h.at + 1).filter((x) => !samePlace(x, p)), p].slice(-HISTORY_CAP);
  return { list, at: list.length - 1 };
}

/** Back (-1) or forward (+1) to the nearest place that still exists; null when there is none. */
export function travel(h: History, dir: 1 | -1, exists: (p: Place) => boolean): number | null {
  for (let i = h.at + dir; i >= 0 && i < h.list.length; i += dir) if (exists(h.list[i])) return i;
  return null;
}

/** The longest query the palette searches; a longer paste is refused. */
export const MAX_QUERY = 200;

/** The query's words, lower case. */
export const wordsOf = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);

/** Where every word matches in `text`, as [start, end) ranges for highlighting, merged and in
 * order; null when any word matches nowhere. No words: an empty match. */
export function matchWords(text: string, words: string[]): [number, number][] | null {
  const low = text.toLowerCase();
  const spans: [number, number][] = [];
  for (const w of words) {
    let i = low.indexOf(w);
    if (i < 0) return null;
    for (; i >= 0; i = low.indexOf(w, i + w.length)) spans.push([i, i + w.length]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else out.push([...s]);
  }
  return out;
}
