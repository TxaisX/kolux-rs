// TERM-045: closing a tab whose program is still running asks first; an idle shell closes at once.

/** Settings field: false turns the question off (Settings > Terminal & sessions). */
export const CONFIRM_CLOSE_FIELD = "confirmCloseRunning";

export const asksBeforeClose = (settings: Record<string, unknown>): boolean => settings[CONFIRM_CLOSE_FIELD] !== false;

/** How many of `ids` would stop a live program if closed. A failed check counts none (fails open). */
export async function busyCount(ids: number[], check: (ids: number[]) => Promise<boolean[]>): Promise<number> {
  if (ids.length === 0) return 0;
  try {
    return (await check(ids)).filter(Boolean).length;
  } catch {
    return 0;
  }
}

/** The question for closing the tab called `name`, with `busy` of its `panes` panes running a program. */
export function closeQuestion(name: string, busy: number, panes: number): { title: string; body: string } {
  const body = panes <= 1 ? "A program is still running in it. Closing the tab stops it." : `A program is still running in ${busy} of its ${panes} panes. Closing the tab stops them.`;
  return { title: `Close “${name}”?`, body };
}
