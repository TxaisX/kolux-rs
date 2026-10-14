// SET-061 (T-323): the mouse wheel scrolls long pickers and menus, dialogs included. Inside a menu
// the wheel moves the closest part between the pointer and the menu's edge that can still scroll
// that way; sideways-only or clipping parts are passed over; when nothing can scroll the wheel is
// swallowed so nothing behind the menu jumps; a control that handles the wheel itself goes first.

/** What the rule needs from an element (a DOM element adapts to this in installMenuWheel). */
export type Box = { overflowY: string; scrollTop: number; scrollHeight: number; clientHeight: number; parent: Box | null };

const scrolls = (b: Box) => (b.overflowY === "auto" || b.overflowY === "scroll") && b.scrollHeight > b.clientHeight + 1;
const room = (b: Box, dy: number) => (dy > 0 ? b.scrollTop + b.clientHeight < b.scrollHeight - 1 : dy < 0 ? b.scrollTop > 0 : false);

/** The part to scroll, walking out from the pointer to the menu itself (the box whose parent is
 *  null); null when none can move. */
export function wheelTarget(start: Box, dy: number): Box | null {
  for (let b: Box | null = start; b; b = b.parent) if (scrolls(b) && room(b, dy)) return b;
  return null;
}

/** The floating surfaces the rule covers: menus, pickers, sheets, and listboxes marked as popups.
 *  An inline listbox (a run list on a page) is not one: the wheel over it scrolls its page. */
export const MENU_SELECTOR = '[role="menu"], [role="listbox"][data-popup], .menu, .picker, .ws-sheet';

/** What the rule reads from an element; a DOM element is one, SVG icons included. */
export type El = {
  closest(selector: string): El | null;
  parentElement: El | null;
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
};
/** The wheel event fields the rule reads. */
export type Wheel = { target: unknown; deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; defaultPrevented: boolean; preventDefault(): void };
type Style = (el: El) => { overflowY: string };

const isEl = (t: unknown): t is El => typeof t === "object" && t !== null && typeof (t as El).closest === "function";

const box = (el: El, menu: El, style: Style): Box => {
  const parent = el === menu || !el.parentElement ? null : el.parentElement;
  return {
    get overflowY() {
      return style(el).overflowY;
    },
    get scrollTop() {
      return el.scrollTop;
    },
    get scrollHeight() {
      return el.scrollHeight;
    },
    get clientHeight() {
      return el.clientHeight;
    },
    get parent() {
      return parent ? box(parent, menu, style) : null;
    },
    el,
  } as Box & { el: El };
};

/** Lines and pages in pixels, for wheels that report in those units. */
export const pixels = (dy: number, mode: number, page = 600) => (mode === 1 ? dy * 16 : mode === 2 ? dy * page : dy);

/** One wheel event: inside a floating surface the rule decides what moves; anywhere else the
 *  browser's own scrolling is left alone. */
export function onMenuWheel(e: Wheel, style: Style): void {
  if (e.defaultPrevented || e.ctrlKey || !isEl(e.target)) return;
  const start = e.target;
  const menu = start.closest(MENU_SELECTOR);
  if (!menu) return;
  const dy = pixels(e.deltaY, e.deltaMode, menu.clientHeight);
  if (Math.abs(e.deltaX) > Math.abs(dy)) return;
  const hit = wheelTarget(box(start, menu, style), dy) as (Box & { el: El }) | null;
  e.preventDefault();
  if (hit) hit.el.scrollTop += dy;
}

/** Installs the rule on a document once; returns the uninstall. */
export function installMenuWheel(doc: Document): () => void {
  const style: Style = (el) => getComputedStyle(el as unknown as Element);
  const on = (e: WheelEvent) => onMenuWheel(e, style);
  doc.addEventListener("wheel", on, { passive: false });
  return () => doc.removeEventListener("wheel", on);
}
