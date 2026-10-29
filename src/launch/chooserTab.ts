// T-577 (Txais 2026-10-28, T-569): a pane still showing the launch chooser has nothing running yet, so its tab
// reads "New session" rather than "Terminal N". Once an agent or a terminal starts the pane loses its seats and
// the tab takes the usual name. A name the user gave the tab still wins.
export const CHOOSER_TAB = "New session";

export function chooserTabName(p: { seats?: unknown; title?: string }): string | null {
  if (!p.seats) return null;
  return p.title?.trim() ? p.title : CHOOSER_TAB;
}
