// T-239 (BROW-017): Kolux's own right-click menu inside a page. The page reports where the click
// was, how big it is and what was under the pointer (browser.rs CHORD_SCRIPT, the `browser-menu`
// event); this module decides the entries and where the menu sits, flipped so it stays inside the
// pane near its edges; the page then draws it (`__kxMenu`) and reports the entry picked.

export type MenuContext = { link: string; selection: boolean };
export type MenuItem = { id: string; label: string; url?: string; off?: boolean } | { sep: true };
export type MenuAt = { x: number; y: number; vw: number; vh: number };
export type MenuColours = { bg: string; fg: string; line: string; hover: string };
export type MenuSpec = MenuColours & { x: number; y: number; w: number; items: MenuItem[] };

/** The menu's width and the height of a row, a separator and the padding, as the page draws them. */
export const MENU_W = 220;
export const ROW_H = 26;
export const SEP_H = 9;
export const PAD_H = 8;

/** Back and forward always; Copy when text is selected; the link entries for a link, else the
 * page's own Open Page In Default Browser. Entries the page cannot do yet are shown greyed. */
export function menuEntries(ctx: MenuContext, can: { back: boolean; forward: boolean }, page: string): MenuItem[] {
  const items: MenuItem[] = [
    { id: "back", label: "Back", off: !can.back },
    { id: "forward", label: "Forward", off: !can.forward },
  ];
  if (ctx.selection) items.push({ sep: true }, { id: "copy", label: "Copy" });
  if (ctx.link) {
    items.push({ sep: true }, { id: "open-kolux", label: "Open Link In Kolux Browser", url: ctx.link }, { id: "open-default", label: "Open Link In Default Browser", url: ctx.link }, { id: "copy-link", label: "Copy Link Address", url: ctx.link });
  } else {
    items.push({ sep: true }, { id: "open-default", label: "Open Page In Default Browser", url: page, off: !/^https?:/i.test(page) });
  }
  return items;
}

export function menuHeight(items: MenuItem[]): number {
  return PAD_H + items.reduce((h, it) => h + ("sep" in it ? SEP_H : ROW_H), 0);
}

/** Where the menu's top-left corner goes: at the pointer, flipped to the left of it or above it
 * when it would run past the page's right or bottom edge, and never off the top or left. */
export function placeMenu(at: MenuAt, w: number, h: number): { x: number; y: number } {
  let { x, y } = at;
  if (x + w > at.vw) x -= w;
  if (y + h > at.vh) y -= h;
  return { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) };
}

/** The whole spec the page draws from. */
export function menuSpec(ctx: MenuContext, can: { back: boolean; forward: boolean }, page: string, at: MenuAt, colours: MenuColours): MenuSpec {
  const items = menuEntries(ctx, can, page);
  const { x, y } = placeMenu(at, MENU_W, menuHeight(items));
  return { ...colours, x, y, w: MENU_W, items };
}

/** The payload of a `browser-menu` event (every field arrives as text). */
export type MenuEvent = { id: number; kind: "menu" | "pick"; x?: string; y?: string; vw?: string; vh?: string; s?: string; l?: string; what?: string; u?: string };

export function menuAt(e: MenuEvent): MenuAt {
  const n = (s: string | undefined) => {
    const v = Number(s);
    return Number.isFinite(v) ? v : 0;
  };
  return { x: n(e.x), y: n(e.y), vw: n(e.vw), vh: n(e.vh) };
}

export function menuContext(e: MenuEvent): MenuContext {
  return { link: /^https?:/i.test(e.l ?? "") ? e.l! : "", selection: e.s === "1" };
}

/** The pane's colours for the menu, read from the app's theme tokens on `el`; a plain dark menu when
 * they cannot be read (tests). */
export function menuColours(el: Element | null): MenuColours {
  const read = (name: string, fallback: string) => {
    const v = el && typeof getComputedStyle === "function" ? getComputedStyle(el).getPropertyValue(name).trim() : "";
    return v || fallback;
  };
  return { bg: read("--surface", "#1f1f1f"), fg: read("--fg", "#e6e6e6"), line: read("--line-subtle", "#3a3a3a"), hover: read("--chip-bg", "#333333") };
}
