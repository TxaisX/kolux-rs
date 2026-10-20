// T-102-b / T-094-a: an editor pane that a move rebuilds keeps its caret, selection and scroll.
// The editor puts its view state here when it is torn down and takes it back when the same tab key
// is built again; the store is per tab key, bounded, and never shared between tabs. Pure.
export type EditorView = { anchor: number; head: number; scrollTop: number; scrollLeft: number };

const MAX_KEPT = 64;
const kept = new Map<number, EditorView>();

/** Keep `view` for tab `key` (replacing any earlier one); the oldest entry goes past the bound. */
export function keepView(key: number, view: EditorView): void {
  kept.delete(key);
  kept.set(key, view);
  while (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value as number);
}

/** The kept state for `key`, removed so a later build starts clean; null when none. */
export function takeView(key: number): EditorView | null {
  const v = kept.get(key) ?? null;
  kept.delete(key);
  return v;
}

/** Forget a closed tab's state. */
export const forgetView = (key: number): void => void kept.delete(key);

/** The state clamped to a document of `length` characters (the file may have changed meanwhile). */
export const clampView = (v: EditorView, length: number): EditorView => ({
  anchor: Math.max(0, Math.min(v.anchor, length)),
  head: Math.max(0, Math.min(v.head, length)),
  scrollTop: Math.max(0, v.scrollTop),
  scrollLeft: Math.max(0, v.scrollLeft),
});

/** Test hook: how many tabs have state kept. */
export const keptCount = (): number => kept.size;
