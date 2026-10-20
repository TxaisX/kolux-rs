// TERM-059 / TERM-060 (T-220): where the floating workspace panel and its trigger button sit.
// Pure: the window size goes in, a rectangle comes out. Saved places are read defensively (broken
// data gives the default), the panel is always kept inside the window, it may touch but never cover
// a macOS title bar (`inset`), and maximize keeps the normal rectangle for the restore.
export type Rect = { x: number; y: number; w: number; h: number };
export type Win = { w: number; h: number };
export type Saved = { rect: Rect; maximized: boolean };
export type Pos = { x: number; y: number };

export const SETTING_PANEL = "floatingPanel";
export const SETTING_BUTTON = "floatingButton";
export const MIN: Win = { w: 320, h: 220 };
export const BUTTON = 44;
const GAP = 16;
/** Room kept under the button for the status bar so the default button does not sit on it. */
const FOOT = 28;
/** The height of the macOS title bar the panel may touch but not cover. */
export const MAC_INSET = 28;

export const insetFor = (platform: string): number => (/mac/i.test(platform) ? MAC_INSET : 0);

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const between = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** The default panel: a bit over half the window, at the bottom right above the button. */
export function defaultRect(win: Win, inset = 0): Rect {
  const w = Math.min(Math.max(Math.round(win.w * 0.5), MIN.w), win.w);
  const h = Math.min(Math.max(Math.round(win.h * 0.55), MIN.h), Math.max(win.h - inset, MIN.h));
  return clampRect({ x: win.w - w - GAP, y: win.h - h - GAP - BUTTON - FOOT, w, h }, win, inset);
}

/** The rectangle pulled inside the window: no smaller than MIN (when the window allows), never past an edge or into the inset. */
export function clampRect(r: Rect, win: Win, inset = 0): Rect {
  const w = Math.min(Math.max(r.w, MIN.w), Math.max(win.w, 1));
  const h = Math.min(Math.max(r.h, MIN.h), Math.max(win.h - inset, 1));
  return { x: Math.round(between(r.x, 0, win.w - w)), y: Math.round(between(r.y, inset, win.h - h)), w: Math.round(w), h: Math.round(h) };
}

/** Saved geometry as stored; anything broken (not an object, a NaN, a string size) gives the default. */
export function parseSaved(raw: unknown, win: Win, inset = 0): Saved {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!o || !num(o.x) || !num(o.y) || !num(o.w) || !num(o.h) || o.w <= 0 || o.h <= 0) return { rect: defaultRect(win, inset), maximized: false };
  return { rect: clampRect({ x: o.x, y: o.y, w: o.w, h: o.h }, win, inset), maximized: o.maximized === true };
}

/** What is stored for a place. */
export const toStored = (s: Saved) => ({ ...s.rect, maximized: s.maximized });

/** The rectangle on screen: the whole window below the inset when maximized, else the normal one kept inside. */
export function shown(s: Saved, win: Win, inset = 0): Rect {
  return s.maximized ? { x: 0, y: inset, w: win.w, h: Math.max(win.h - inset, 1) } : clampRect(s.rect, win, inset);
}

/** Maximize keeps the normal rectangle; the next call restores it. */
export const toggleMaximize = (s: Saved): Saved => ({ rect: s.rect, maximized: !s.maximized });

/** Dragging the title bar by (dx, dy). */
export const moveBy = (r: Rect, dx: number, dy: number, win: Win, inset = 0): Rect => clampRect({ ...r, x: r.x + dx, y: r.y + dy }, win, inset);

export type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Dragging an edge or corner by (dx, dy): the opposite edge stays, and MIN stops it shrinking further. */
export function resizeBy(r: Rect, edge: Edge, dx: number, dy: number, win: Win, inset = 0): Rect {
  let { x, y, w, h } = r;
  if (edge.includes("e")) w = Math.max(MIN.w, w + dx);
  if (edge.includes("s")) h = Math.max(MIN.h, h + dy);
  if (edge.includes("w")) {
    const nw = Math.max(MIN.w, w - dx);
    x += w - nw;
    w = nw;
  }
  if (edge.includes("n")) {
    const nh = Math.max(MIN.h, h - dy);
    y += h - nh;
    h = nh;
  }
  return clampRect({ x, y, w, h }, win, inset);
}

/** TERM-060: a press that starts on a tab icon (or anything marked no-drag) does not move the panel. */
export const startsPanelMove = (target: { closest?: (sel: string) => unknown } | null): boolean => !target?.closest?.("[data-nodrag]");

/** The button's default: bottom right of the window, above the status bar. */
export const defaultButton = (win: Win): Pos => ({ x: Math.max(win.w - BUTTON - GAP, 0), y: Math.max(win.h - BUTTON - GAP - FOOT, 0) });

/** The button kept inside the window (it stays reachable when the window shrinks). */
export const clampButton = (p: Pos, win: Win): Pos => ({ x: Math.round(between(p.x, 0, win.w - BUTTON)), y: Math.round(between(p.y, 0, win.h - BUTTON)) });

/** The saved button place; broken data gives the default. */
export function parseButton(raw: unknown, win: Win): Pos {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  return o && num(o.x) && num(o.y) ? clampButton({ x: o.x, y: o.y }, win) : defaultButton(win);
}
