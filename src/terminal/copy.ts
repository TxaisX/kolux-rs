// TERM-065: copying the terminal selection never lies. Nothing selected is not a copy, so no
// success is ever reported for it; a clipboard that refuses keeps the selection on screen and
// says so at most once every few seconds; the keyboard goes back to the pane either way.
// VIEW-110 (T-253): a selection past the copy limit is not handed to the clipboard (a huge write can stall or crash the
// web view); it says how big it was and what the limit is, and the selection stays.
export type CopyOutcome = "copied" | "empty" | "failed" | "too-big";

/** The most text one terminal copy hands to the clipboard, in characters (about 10 MB of plain text). */
export const COPY_CAP = 10 * 1024 * 1024;

const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;
/** The message for a copy over the limit. */
export const tooBigNotice = (size: number, cap = COPY_CAP) => `The selection is too big to copy (${mb(size)} of text; the limit is ${mb(cap)}). Select less and copy again.`;

export type SelectionLike = { hasSelection(): boolean; getSelection(): string; focus(): void };

const NOTICE_EVERY = 5_000;
const shared = { lastNotice: 0 };

export async function copySelection(
  term: SelectionLike,
  write: (text: string) => Promise<void>,
  notice: (message: string) => void,
  now: () => number = Date.now,
  throttle: { lastNotice: number } = shared,
  cap: number = COPY_CAP,
): Promise<CopyOutcome> {
  const text = term.hasSelection() ? term.getSelection() : "";
  if (!text) return "empty";
  if (text.length > cap) {
    notice(tooBigNotice(text.length, cap));
    term.focus();
    return "too-big";
  }
  try {
    await write(text);
    return "copied";
  } catch (err) {
    const t = now();
    if (t - throttle.lastNotice >= NOTICE_EVERY) {
      throttle.lastNotice = t;
      notice(`The clipboard refused the copy (${String(err instanceof Error ? err.message : err)}). The selection is still here; try again.`);
    }
    return "failed";
  } finally {
    term.focus();
  }
}

