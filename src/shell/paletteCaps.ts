// VIEW-039: the palette shows up to 20 rows per section with a "more" count that adds 20 at a time, never lists the same
// row twice, and gives focus back when it closes: the element it came from, else a terminal, else an editor.

export const STEP = 20;

type Keyed = { section: string; label: string; hint?: string; parent?: string; dir?: string };

/** A row's identity: two rows with the same one would draw twice (ghost rows), so only the first stays. */
export const rowKey = (r: Keyed) => [r.section, r.label, r.hint ?? "", r.parent ?? "", r.dir ?? ""].join("\u0001");

export function dedupe<T extends Keyed>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = rowKey(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * The rows to draw. `rows` come grouped by section (the order they are listed in); `extra` is how many more 20s a section was
 * asked for. `more` is how many rows are still hidden in each section that has hidden ones.
 */
export function capRows<T extends Keyed>(rows: T[], extra: Record<string, number> = {}): { shown: T[]; more: Record<string, number> } {
  const used: Record<string, number> = {};
  const hidden: Record<string, number> = {};
  const shown: T[] = [];
  for (const r of dedupe(rows)) {
    const limit = STEP * (1 + (extra[r.section] ?? 0));
    used[r.section] = (used[r.section] ?? 0) + 1;
    if (used[r.section] <= limit) shown.push(r);
    else hidden[r.section] = (hidden[r.section] ?? 0) + 1;
  }
  return { shown, more: hidden };
}

/** The text on a section's more control: how many are hidden, and that it adds `STEP` (or fewer when that is all that is left). */
export const moreLabel = (hidden: number) => `${hidden} more`;
export const moreTitle = (hidden: number) => `Show ${Math.min(STEP, hidden)} more`;

/** What can take focus when the palette closes, in order. */
export const FOCUS_FALLBACKS = [".xterm-helper-textarea", ".cm-content", "[contenteditable='true']"];

type Focusable = { isConnected: boolean; focus: () => void };

/** Give focus back: to `prev` when it is still on the page, else the first fallback that exists. True when something took it. */
export function restoreFocus(prev: Focusable | null, find: (selector: string) => Focusable | null): boolean {
  if (prev && prev.isConnected) {
    prev.focus();
    return true;
  }
  for (const sel of FOCUS_FALLBACKS) {
    const el = find(sel);
    if (el) {
      el.focus();
      return true;
    }
  }
  return false;
}
