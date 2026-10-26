// Row 837: All Changes mounts only the sections near the viewport. Sections differ in height, so
// the list keeps one height per section (an estimate until the mounted section is measured), turns
// them into running offsets, and picks the slice to mount from the scroll position. No React here.

/** The gap between sections, the same 10 px the list used between its flex children. */
export const SECTION_GAP = 10;
/** A section's border and header; the body is estimated on top of it. */
export const SECTION_CHROME = 32;
/** How far past the viewport a section still mounts (the old per-section observer used 800 px). */
export const OVERSCAN_PX = 600;
/** Whole sections kept mounted beyond the pixel margin on each side. */
export const SPARE_SECTIONS = 1;
/** The viewport height assumed until the list has been measured. */
export const FALLBACK_VIEWPORT = 900;

export type Layout = { offsets: number[]; total: number };
export type Slice = { start: number; end: number; top: number; bottom: number };

/** `offsets[i]` is where section i starts; `offsets[n]` is where a section n would. */
export function layoutOf(heights: readonly number[], gap = SECTION_GAP): Layout {
  const offsets = new Array<number>(heights.length + 1);
  let y = 0;
  for (let i = 0; i < heights.length; i++) {
    offsets[i] = y;
    y += heights[i] + gap;
  }
  offsets[heights.length] = y;
  return { offsets, total: Math.max(0, y - gap) };
}

/** The section that contains `y`: the last one starting at or above it. */
export function indexAt(layout: Layout, y: number): number {
  const n = layout.offsets.length - 1;
  if (n <= 0) return 0;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (layout.offsets[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The sections to mount for a scroll position, and the two spacers that stand in for the rest. */
export function sliceOf(layout: Layout, scrollTop: number, viewport: number, overscan = OVERSCAN_PX, spare = SPARE_SECTIONS, gap = SECTION_GAP): Slice {
  const n = layout.offsets.length - 1;
  if (n <= 0) return { start: 0, end: 0, top: 0, bottom: 0 };
  const start = Math.max(0, indexAt(layout, scrollTop - overscan) - spare);
  const end = Math.min(n, indexAt(layout, scrollTop + Math.max(viewport, 0) + overscan) + 1 + spare);
  return { start, end, top: start > 0 ? layout.offsets[start] - gap : 0, bottom: end < n ? layout.total - layout.offsets[end] : 0 };
}

/** Where the scroll must be so that the section still at `scrollTop` stays under the same pixel after a re-layout. */
export function anchoredScroll(before: Layout, after: Layout, scrollTop: number): number {
  const i = indexAt(before, scrollTop);
  return scrollTop + (after.offsets[i] - before.offsets[i]);
}

/** The sections that have drawn, by key, and the stamp each drew. A section subscribes to its own key. */
export type ReadyStore = {
  get: (key: string) => string | undefined;
  set: (key: string, stamp: string | null) => void;
  subscribe: (key: string, on: () => void) => () => void;
  /** Every change, for a total (the "n viewed" count). */
  subscribeAll: (on: () => void) => () => void;
  version: () => number;
};

export function readyStore(): ReadyStore {
  const stamps = new Map<string, string>();
  const byKey = new Map<string, Set<() => void>>();
  const all = new Set<() => void>();
  let version = 0;
  return {
    get: (key) => stamps.get(key),
    set: (key, stamp) => {
      if ((stamps.get(key) ?? null) === stamp) return;
      if (stamp === null) stamps.delete(key);
      else stamps.set(key, stamp);
      version++;
      byKey.get(key)?.forEach((f) => f());
      all.forEach((f) => f());
    },
    subscribe: (key, on) => {
      const set = byKey.get(key) ?? new Set<() => void>();
      set.add(on);
      byKey.set(key, set);
      return () => {
        set.delete(on);
        if (!set.size) byKey.delete(key);
      };
    },
    subscribeAll: (on) => {
      all.add(on);
      return () => void all.delete(on);
    },
    version: () => version,
  };
}
