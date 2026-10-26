// Row 837: the React side of the All Changes window (the maths is in sectionWindow.ts). It follows
// the list's scroll and height, measures the mounted sections with ONE shared ResizeObserver, keeps
// the view steady when a section above it changes height, and jumps to a section that is not mounted.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { anchoredScroll, FALLBACK_VIEWPORT, layoutOf, sliceOf, type Layout, type ReadyStore, type Slice } from "./sectionWindow";

export type SectionItem = { key: string; /** height before it is measured, border and header included */ guess: number; folded: boolean };
/** Starts measuring one mounted section; the returned function stops. */
export type Meter = { watch: (el: HTMLElement, key: string) => () => void };
export type SectionWindow = { layout: Layout; slice: Slice; meter: Meter; onScroll: () => void; jumpTo: (index: number) => void };

export function useSectionWindow(list: RefObject<HTMLDivElement | null>, inner: RefObject<HTMLDivElement | null>, items: SectionItem[], initialTop = 0): SectionWindow {
  const measured = useRef(new Map<string, { h: number; f: boolean }>());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const indexByKey = useMemo(() => new Map(items.map((it, i) => [it.key, i])), [items]);
  const indexRef = useRef(indexByKey);
  indexRef.current = indexByKey;
  const build = useCallback(
    (): Layout =>
      layoutOf(
        itemsRef.current.map((it) => {
          const m = measured.current.get(it.key);
          return m && m.f === it.folded ? m.h : it.guess;
        }),
      ),
    [],
  );
  const [version, setVersion] = useState(0);
  const [, setTick] = useState(0);
  const layout = useMemo(build, [build, items, version]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const view = useRef({ top: initialTop, height: FALLBACK_VIEWPORT });
  const origin = useRef(8); // where the section column starts inside the scroller (its padding, any notice above)
  const slice = sliceOf(layout, view.current.top - origin.current, view.current.height);
  const sliceRef = useRef(slice);
  sliceRef.current = slice;

  // Reads the scroller and re-renders only when the set of mounted sections would change.
  const refresh = useCallback(() => {
    const l = list.current;
    if (!l || !l.clientHeight) return; // hidden tab: keep what is mounted
    view.current = { top: l.scrollTop, height: l.clientHeight };
    const next = sliceOf(layoutRef.current, view.current.top - origin.current, view.current.height);
    if (next.start !== sliceRef.current.start || next.end !== sliceRef.current.end) setTick((t) => t + 1);
  }, [list]);

  const frame = useRef(0);
  const onScroll = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      refresh();
    });
  }, [refresh]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  useLayoutEffect(() => {
    origin.current = inner.current?.offsetTop ?? origin.current;
  });
  useLayoutEffect(() => {
    const l = list.current;
    if (!l) return;
    refresh();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(refresh);
    watch.observe(l);
    return () => watch.disconnect();
  }, [list, refresh]);

  // One observer for every mounted section. A change above the first visible section moves the
  // content under the reader, so the scroll moves by the same amount (the CSS anchoring is off).
  const meter = useMemo<Meter>(() => {
    if (typeof ResizeObserver === "undefined") return { watch: () => () => undefined };
    const keys = new WeakMap<Element, string>();
    const watch = new ResizeObserver((records) => {
      let changed = false;
      for (const r of records) {
        const key = keys.get(r.target);
        const i = key === undefined ? undefined : indexRef.current.get(key);
        const h = (r.target as HTMLElement).offsetHeight;
        if (key === undefined || i === undefined || !h) continue; // 0 = the tab is hidden
        const folded = itemsRef.current[i].folded;
        const prev = measured.current.get(key);
        if (prev && prev.h === h && prev.f === folded) continue;
        measured.current.set(key, { h, f: folded });
        changed = true;
      }
      if (!changed) return;
      const before = layoutRef.current;
      const after = build();
      const l = list.current;
      if (l) {
        const local = l.scrollTop - origin.current;
        const delta = anchoredScroll(before, after, local) - local;
        if (delta) l.scrollTop += delta;
        view.current = { top: l.scrollTop, height: view.current.height };
      }
      layoutRef.current = after;
      setVersion((v) => v + 1);
    });
    return {
      watch: (el, key) => {
        keys.set(el, key);
        watch.observe(el);
        return () => {
          watch.unobserve(el);
          keys.delete(el);
        };
      },
    };
  }, [build, list]);

  // Sections near the target draw while the jump lands and change height, so the jump is aimed
  // again a few times until they settle, unless the user scrolls first.
  const stopJump = useRef<(() => void) | null>(null);
  const jumpTo = useCallback(
    (index: number) => {
      const l = list.current;
      if (!l) return;
      stopJump.current?.();
      const go = () => {
        const at = layoutRef.current.offsets[Math.min(index, layoutRef.current.offsets.length - 1)] ?? 0;
        l.scrollTop = origin.current + at;
        refresh();
      };
      let n = 0;
      const stop = () => {
        window.clearInterval(t);
        l.removeEventListener("wheel", stop);
        l.removeEventListener("pointerdown", stop);
        stopJump.current = null;
      };
      const t = window.setInterval(() => (++n > 8 ? stop() : go()), 100);
      l.addEventListener("wheel", stop, { passive: true });
      l.addEventListener("pointerdown", stop);
      stopJump.current = stop;
      go();
    },
    [list, refresh],
  );
  useEffect(() => () => stopJump.current?.(), []);

  return { layout, slice, meter, onScroll, jumpTo };
}

/** The stamp a section drew, re-rendering only the caller when this key changes. */
export function useReadyStamp(store: ReadyStore, key: string): string | undefined {
  const subscribe = useCallback((on: () => void) => store.subscribe(key, on), [store, key]);
  const get = () => store.get(key);
  return useSyncExternalStore(subscribe, get, get);
}

/** A counter that moves on any change, for totals over every section. */
export function useReadyVersion(store: ReadyStore): number {
  return useSyncExternalStore(store.subscribeAll, store.version, store.version);
}
