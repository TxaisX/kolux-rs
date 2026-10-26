// Native chat, long conversations in pages (CHAT-008; T-334): the latest 300 messages first, each press of
// Load earlier messages adds 200 older ones, and the control is gone once the beginning is reached.
// Pure rules here; ChatView.tsx keeps the reading position when a page is added.

export const FIRST_PAGE = 300;
export const NEXT_PAGE = 200;

/** CHAT-008 backend paging, counted in transcript lines (a line is about a row): what the first read takes, and one older page. */
export const FIRST_LINES = 1500;
export const OLDER_LINES = 800;

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

/** The label of the control, or null when the beginning is already shown. `older`: the transcript has lines before the
 * ones read (a cursor above 0); with every row read shown, pressing fetches the next older page from the backend. */
export function loadLabel(total: number, pages: number, older = 0): string | null {
  const hidden = hiddenCount(total, pages);
  if (hidden > 0) return `Load earlier messages (${Math.min(NEXT_PAGE, hidden)} more)`;
  return older > 0 ? "Load earlier messages" : null;
}

/** An older page put before the rows held; a row the view already holds (a message the page boundary cut) keeps the held version. */
export function prependOlder<T extends { id: string }>(held: readonly T[], older: readonly T[]): T[] {
  const have = new Set(held.map((x) => x.id));
  return [...older.filter((x) => !have.has(x.id)), ...held];
}

/** The scroll position after older rows were put above the view: the same message stays where it was. */
export const keepPosition = (before: { scrollHeight: number; scrollTop: number }, afterHeight: number) => before.scrollTop + (afterHeight - before.scrollHeight);

/**
 * CHAT-008: a page opened for one reading (`epoch`) never lands on a later one. The chat bumps the epoch when it is
 * hidden or shown again, so a page that finishes late is dropped.
 */
export const pageIsCurrent = (startedEpoch: number, nowEpoch: number) => startedEpoch === nowEpoch;
