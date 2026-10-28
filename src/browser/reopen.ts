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

/** Why the page is rebuilt: the pane's own recovery ("auto") or the user's Retry ("retry"). The back
 *  end keeps the tab's saved profile for both, never hands them the keyboard, and lets only "retry"
 *  clear a page's record of closing itself (row 954 c). */
export type Why = "auto" | "retry";
/** What a rebuild asks the pane while it runs (row 954 c, H5): is the pane still there, and put the
 *  page where the pane is NOW (the size, and shown or hidden, may have changed during the rebuild). */
export type Live = { alive: () => boolean; sync: () => void };

/** Closes the tab's page, then opens it again where the pane is. A close that fails (the page is
 *  already gone) does not stop the reopen; an open that fails rejects so the pane can say so. A pane
 *  that unmounted meanwhile gets no page, or the one just built is closed again. */
export async function reopenPage(call: Call, id: number, at: Opening, why: Why = "auto", live?: Live): Promise<void> {
  await call("browser_close", { id }).catch(() => {});
  if (live && !live.alive()) return;
  await openPage(call, id, { url: at.url, spot: at.spot, background: at.background, shown: at.shown, rebuild: why, ...(at.profile === undefined ? {} : { profile: at.profile }) });
  if (!live) return;
  if (!live.alive()) return void (await call("browser_close", { id }).catch(() => {}));
  live.sync();
}

/** Opens the tab's page, then tells the back end the pane is up (after-list 719): permission and
 *  download notices raised while the page was being built are held and sent now. A failed open
 *  rejects; a failed announcement changes nothing the user sees. */
export async function openPage(call: Call, id: number, args: Record<string, unknown>): Promise<void> {
  await call("browser_open", { id, ...args });
  await call("browser_pane_ready", { id }).catch(() => {});
}
