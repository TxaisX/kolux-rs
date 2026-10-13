// TERM-065: copying the terminal selection never lies. Nothing selected is not a copy, so no
// success is ever reported for it; a clipboard that refuses keeps the selection on screen and
// says so at most once every few seconds; the keyboard goes back to the pane either way.
export type CopyOutcome = "copied" | "empty" | "failed";

export type SelectionLike = { hasSelection(): boolean; getSelection(): string; focus(): void };

const NOTICE_EVERY = 5_000;
const shared = { lastNotice: 0 };

export async function copySelection(
  term: SelectionLike,
  write: (text: string) => Promise<void>,
  notice: (message: string) => void,
  now: () => number = Date.now,
  throttle: { lastNotice: number } = shared,
): Promise<CopyOutcome> {
  const text = term.hasSelection() ? term.getSelection() : "";
  if (!text) return "empty";
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

