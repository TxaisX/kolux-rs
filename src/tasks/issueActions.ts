// FIX-1 (council FS 2): how the issue actions in an issue's dialog (close, reopen, comment) run, kept
// out of the component so the order is tested: the buttons stay busy until the refreshed issue is
// back, and a gh timeout on a write says it may have gone through.

export type IssueAction = "close" | "reopen" | "comment" | "create";

const DONE: Record<IssueAction, string> = { close: "the issue may have been closed", reopen: "the issue may have been reopened", comment: "the comment may have been posted", create: "the issue may have been opened" };

/** What the dialog says when an action failed. A timeout means gh stopped waiting, not that GitHub
 * refused, so the write may have landed: refreshing first avoids sending it twice. */
export function actionError(error: string, what: IssueAction): string {
  // FIX-2 (council AFTER 1): after a create there is no issue to refresh yet, only the list.
  return /did not answer within/i.test(error) ? `gh did not answer in time, so ${DONE[what]}; refresh the ${what === "create" ? "list" : "issue"} before trying again.` : error;
}

/** Sends one action, then (on success) runs `after` and waits for `refresh`; busy is set for the
 * whole run and cleared only after the refresh has come back. `onFail` runs after a failure (GIT-048: the
 * change shown at once is put back). */
export async function runAction(o: { send: Promise<unknown>; refresh: () => Promise<unknown>; after?: () => void; setBusy: (b: boolean) => void; setError: (e: string | null) => void; what: IssueAction; onFail?: () => void }): Promise<void> {
  o.setBusy(true);
  o.setError(null);
  try {
    await o.send;
    o.after?.();
    await o.refresh();
  } catch (e) {
    o.setError(actionError(String(e), o.what));
    o.onFail?.();
  } finally {
    o.setBusy(false);
  }
}
