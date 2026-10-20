// SET-036 (T-181): the small rules around settings fields that are not about saving: a cleared
// number goes back to its default, a segmented choice that cannot be used says why, long option lists
// narrow as the user types, and oversized search text is refused before any filtering.

/** The longest search text a picker takes; longer is refused, not filtered (SET-036). */
export const MAX_SEARCH = 200;

/** A number field's text as a value: empty goes back to `start`; text that is not a number, or is
 * out of range, is null (the field keeps what was typed and the page says why). */
export function numberFromField(text: string, start: number, min: number, max: number): number | null {
  const t = text.trim();
  if (t === "") return start;
  const n = Number(t);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

export type Narrowed<T> = { items: T[]; refused: boolean };

/** The options whose label contains the typed text (case and accents ignored), in their order.
 * Search text over MAX_SEARCH characters is refused: nothing is filtered and `refused` is set. */
export function narrowOptions<T>(options: readonly T[], query: string, label: (o: T) => string): Narrowed<T> {
  if (query.length > MAX_SEARCH) return { items: [...options], refused: true };
  const q = fold(query.trim());
  if (!q) return { items: [...options], refused: false };
  return { items: options.filter((o) => fold(label(o)).includes(q)), refused: false };
}

function fold(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export type SegmentOption<V> = { value: V; label: string; unavailable?: string };
export type SegmentView<V> = { value: V; label: string; disabled: boolean; reason: string | null; selected: boolean };

/** A segmented choice as the page draws it: an unavailable segment is greyed with its reason and
 * cannot be picked, even if it is the stored value (it then stays shown as selected). */
export function segmentViews<V>(options: readonly SegmentOption<V>[], current: V): SegmentView<V>[] {
  return options.map((o) => ({ value: o.value, label: o.label, disabled: !!o.unavailable, reason: o.unavailable ?? null, selected: o.value === current }));
}

type KeyIn = { key: string; ctrlKey?: boolean; metaKey?: boolean; isComposing?: boolean; keyCode?: number };

/** Ctrl or Cmd with Enter submits the current form or dialog, and does nothing while an input
 * method is composing (the Enter there confirms the composition). */
export function isSubmitChord(e: KeyIn): boolean {
  if (e.isComposing || e.keyCode === 229) return false;
  return e.key === "Enter" && !!(e.ctrlKey || e.metaKey);
}
