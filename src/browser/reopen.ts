// BROW-009 / T-241: tearing a page down and opening it again in the same tab, for the two cases a
// plain reload cannot cover: a dead page process, and a tab whose profile changed.

export type Call = (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
export type Spot = { x: number; y: number; w: number; h: number };
/** What `browser_open` needs: the address to come back on, the pane's place and colour, and the
 *  profile to run in when a profile change is the reason (T-241 / BROW-045). */
export type Opening = { url: string; spot: Spot; background: [number, number, number] | null; shown: boolean; profile?: string };

/** The `browser-profile` event the command line sends when a tab's profile changes or is deleted. */
export type ProfileEvent = { page: number; profile: string };
/** Does this profile change name the pane with this id? */
export const namesPane = (e: ProfileEvent, id: number): boolean => e.page === id;

/** Closes the tab's page, then opens it again where the pane is. A close that fails (the page is
 *  already gone) does not stop the reopen; an open that fails rejects so the pane can say so. */
export async function reopenPage(call: Call, id: number, at: Opening): Promise<void> {
  await call("browser_close", { id }).catch(() => {});
  await openPage(call, id, { url: at.url, spot: at.spot, background: at.background, shown: at.shown, ...(at.profile === undefined ? {} : { profile: at.profile }) });
}

/** Opens the tab's page, then tells the back end the pane is up (after-list 719): permission and
 *  download notices raised while the page was being built are held and sent now. A failed open
 *  rejects; a failed announcement changes nothing the user sees. */
export async function openPage(call: Call, id: number, args: Record<string, unknown>): Promise<void> {
  await call("browser_open", { id, ...args });
  await call("browser_pane_ready", { id }).catch(() => {});
}
