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

/** A rebuild under way for a pane, and the one ask waiting behind it (row 954f). */
type Waiting = { run: () => Promise<void>; resolve: () => void; reject: (e: unknown) => void };
const flights = new Map<number, { waiting: Waiting | null }>();

/** Runs `run` as the pane's rebuild; when it ends, the ask waiting behind it runs next, so two never overlap. */
async function fly(id: number, run: () => Promise<void>): Promise<void> {
  const flight: { waiting: Waiting | null } = { waiting: null };
  flights.set(id, flight);
  try {
    await run();
  } finally {
    flights.delete(id);
    const next = flight.waiting;
    if (next) fly(id, next.run).then(next.resolve, next.reject);
  }
}

/** Closes the tab's page, then opens it again where the pane is. A close that fails (the page is
 *  already gone) does not stop the reopen; an open that fails rejects so the pane can say so. A pane
 *  that unmounted meanwhile gets no page, or the one just built is closed again.
 *  Row 954f: a pane runs one reopen at a time. An automatic request while one runs is the same destroy
 *  heard twice, so it is dropped; Retry and a profile change wait their turn, the latest alone. */
export function reopenPage(call: Call, id: number, at: Opening, why: Why = "auto", live?: Live): Promise<void> {
  const run = () => rebuildPage(call, id, at, why, live);
  if (!flights.has(id)) return fly(id, run);
  if (why === "auto" && at.profile === undefined) return Promise.resolve();
  const flight = flights.get(id)!;
  flight.waiting?.resolve(); // superseded
  return new Promise<void>((resolve, reject) => {
    flight.waiting = { run, resolve, reject };
  });
}

async function rebuildPage(call: Call, id: number, at: Opening, why: Why, live?: Live): Promise<void> {
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

/** Row 977: a pane that came back from the saved layout opens its FIRST page with `rebuild: "restore"`,
 *  so the back end reads the tab's own saved profile instead of opening in the default. Later opens
 *  (a reopen, Retry, a profile change) name their own reason. `spent` is set once that first open
 *  has succeeded; a failed one leaves it, so the pane's next try is still the restore. Answers whether
 *  this open was the restore. */
export async function openFirstPage(call: Call, id: number, args: Record<string, unknown>, restored: boolean, spent: { current: boolean }): Promise<boolean> {
  const restoring = restored && !spent.current;
  await openPage(call, id, restoring ? { ...args, rebuild: "restore" } : args);
  spent.current = true;
  return restoring;
}

/** Row 979 (F2): after a pane's first open the address bar takes the keyboard (BROW-001) only when the
 *  user opened the tab to type in it: the pane is the focused one and the open was not a restore. */
export function takesBarFocus(focused: boolean, restoring: boolean): boolean {
  return focused && !restoring;
}
