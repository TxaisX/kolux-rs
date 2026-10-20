// T-239 (BROW-019, BROW-022): what the window knows about its live browser pages. Each pane keeps
// its row here (address, title, site icon, worktree); the jump palette lists the rows (pageRows),
// and a page closed on purpose is remembered so Reopen Closed Tab (Mod+Shift+T) brings it back at
// the same address. The ring is the terminal lane's (src/terminal/closedTabs.ts), newest first.
import { BLANK } from "./address";
import { remember } from "../terminal/closedTabs";

export type PageInfo = { url: string; title: string; icon: string | null; cwd: string | null };
export type ClosedPage = { url: string; title: string; cwd: string | null };

const live = new Map<number, PageInfo>();
let closed: ClosedPage[] = [];

/** A pane's current state; fields left out keep their last value. */
export function livePage(id: number, patch: Partial<PageInfo>): void {
  live.set(id, { url: "", title: "", icon: null, cwd: null, ...live.get(id), ...patch });
}

export function dropPage(id: number): void {
  live.delete(id);
}

export function pageOf(id: number): PageInfo | undefined {
  return live.get(id);
}

export function livePages(): [number, PageInfo][] {
  return [...live.entries()];
}

/** A real close of pane `id` (the close button, Mod+W, a bulk close): its page is kept for
 * reopening when it has an address worth returning to. Internal clean-ups do not call this. */
export function rememberClosed(id: number): boolean {
  const p = live.get(id);
  if (!p || !p.url || p.url === BLANK) return false;
  closed = pushClosed(closed, { url: p.url, title: p.title, cwd: p.cwd });
  return true;
}

/** The most recently closed page, taken out of the ring; null when none is left. */
export function takeClosed(): ClosedPage | null {
  const [page, ring] = popClosed(closed);
  closed = ring;
  return page;
}

export function pushClosed(ring: readonly ClosedPage[], page: ClosedPage): ClosedPage[] {
  return remember(ring, page);
}

export function popClosed(ring: readonly ClosedPage[]): [ClosedPage | null, ClosedPage[]] {
  const [page, ...rest] = ring;
  return [page ?? null, rest];
}

/** The address as the palette shows it: without its scheme, and without a lone trailing slash. */
export function bareAddress(url: string): string {
  if (!url || url === BLANK) return "";
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^([^/?#]+)\/$/, "$1");
}

export type PageRow = { section: "Browser pages"; label: string; hint: string; dir?: string; run: () => void };

/** Same folder in either spelling of the separators and case of the drive letter. */
function sameDir(a: string | null, b: string | null): boolean {
  if (!a || !b) return a === b;
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

/** The palette's rows for the live pages: the current worktree's first, each in a stable order
 * (by tab age), labelled by title (else address) with the bare address as the hint, so a query of
 * several words is matched across both. Picking one calls `go`; when the page has closed meanwhile
 * (`go` finds nothing, or the row is stale) `gone` is called instead and nothing else opens. */
export function pageRows(pages: [number, PageInfo][], current: string | null, go: (id: number) => boolean, gone: () => void): PageRow[] {
  const sorted = [...pages].sort(([ia, a], [ib, b]) => Number(sameDir(b.cwd, current)) - Number(sameDir(a.cwd, current)) || ia - ib);
  return sorted.map(([id, p]) => {
    const address = bareAddress(p.url);
    return {
      section: "Browser pages",
      label: p.title || address || "New Tab",
      hint: address,
      dir: p.cwd ?? undefined,
      run: () => {
        if (!live.has(id) || !go(id)) gone();
      },
    };
  });
}
