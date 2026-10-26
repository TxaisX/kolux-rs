// BROW-009 / T-241: tearing a page down and opening it again in the same tab, for the two cases a
// plain reload cannot cover: a dead page process, and a tab whose profile changed.

export type Call = (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
export type Spot = { x: number; y: number; w: number; h: number };
/** What `browser_open` needs: the address to come back on, the pane's place and colour. */
export type Opening = { url: string; spot: Spot; background: [number, number, number] | null; shown: boolean };

/** Closes the tab's page, then opens it again where the pane is. A close that fails (the page is
 *  already gone) does not stop the reopen; an open that fails rejects so the pane can say so. */
export async function reopenPage(call: Call, id: number, at: Opening): Promise<void> {
  await call("browser_close", { id }).catch(() => {});
  await call("browser_open", { id, url: at.url, spot: at.spot, background: at.background, shown: at.shown });
}
