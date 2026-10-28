// Row 954 (b): a page destroyed its own tab (a popup's opener.close(), a frame's top.close()). The
// back end says so with this event; the pane builds the tab again, or says it stays closed.

export const SELF_CLOSE_EVENT = "browser-selfclosed";

/** `reopen` is false when the same tab closed itself again and again inside ten seconds. */
export type SelfClosed = { id: number; reopen: boolean };

/** The one line the pane shows for it. */
export const selfCloseNotice = (e: SelfClosed): string =>
  e.reopen ? "This page closed itself; Kolux reopened it" : "This page keeps closing itself; Kolux left it closed";
