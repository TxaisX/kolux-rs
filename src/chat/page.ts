// Native chat, long conversations in pages (CHAT-008; T-334): the latest 300 messages first, each press of
// Load earlier messages adds 200 older ones, and the control is gone once the beginning is reached.
// Pure rules here; ChatView.tsx keeps the reading position when a page is added.

export const FIRST_PAGE = 300;
export const NEXT_PAGE = 200;

/** How many of the newest rows to show after `pages` presses of Load earlier messages. */
export const shownCount = (pages: number) => FIRST_PAGE + NEXT_PAGE * Math.max(0, pages);

/** The rows left to show: the newest `shownCount(pages)` of `rows`. */
export function visibleRows<T>(rows: readonly T[], pages: number): T[] {
  const n = shownCount(pages);
  return rows.length <= n ? rows.slice() : rows.slice(rows.length - n);
}

/** How many older rows are still hidden. */
export const hiddenCount = (total: number, pages: number) => Math.max(0, total - shownCount(pages));

/** Pages needed so that, with `total` rows, the beginning is shown. */
export const pagesToStart = (total: number) => Math.max(0, Math.ceil((total - FIRST_PAGE) / NEXT_PAGE));

/** The label of the control, or null when the beginning is already shown. */
export function loadLabel(total: number, pages: number): string | null {
  const hidden = hiddenCount(total, pages);
  return hidden === 0 ? null : `Load earlier messages (${Math.min(NEXT_PAGE, hidden)} more)`;
}

/** The scroll position after older rows were put above the view: the same message stays where it was. */
export const keepPosition = (before: { scrollHeight: number; scrollTop: number }, afterHeight: number) => before.scrollTop + (afterHeight - before.scrollHeight);

/**
 * CHAT-008: a page opened for one reading (`epoch`) never lands on a later one. The chat bumps the epoch when it is
 * hidden or shown again, so a page that finishes late is dropped.
 */
export const pageIsCurrent = (startedEpoch: number, nowEpoch: number) => startedEpoch === nowEpoch;
