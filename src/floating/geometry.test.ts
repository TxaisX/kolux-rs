// TERM-059 / TERM-060: the floating panel and its button stay inside the window and come back where they were.
import { expect, test } from "vitest";
import { BUTTON, clampButton, clampRect, defaultButton, defaultRect, insetFor, MAC_INSET, MIN, moveBy, parseButton, parseSaved, resizeBy, shown, startsPanelMove, toggleMaximize, toStored, type Rect } from "./geometry";

const win = { w: 1400, h: 900 };
const inside = (r: Rect, w = win, inset = 0) => r.x >= 0 && r.y >= inset && r.x + r.w <= w.w && r.y + r.h <= w.h;

test("TERM-059: the default panel sits at the bottom right, inside the window, above the button", () => {
  const r = defaultRect(win);
  expect(inside(r)).toBe(true);
  expect(r.x + r.w).toBeLessThan(win.w);
  expect(r.y + r.h).toBeLessThanOrEqual(defaultButton(win).y);
});

test("TERM-060: a saved size and place come back as they were", () => {
  const saved = { rect: { x: 100, y: 120, w: 640, h: 400 }, maximized: false };
  expect(parseSaved(JSON.parse(JSON.stringify(toStored(saved))), win)).toEqual(saved);
});

test("TERM-060: corrupt saved geometry opens the panel at the default size and place", () => {
  const dflt = { rect: defaultRect(win), maximized: false };
  for (const bad of [null, undefined, "x", 7, {}, { x: "1", y: 2, w: 3, h: 4 }, { x: NaN, y: 0, w: 500, h: 400 }, { x: 0, y: 0, w: 0, h: 400 }, { x: 0, y: 0, w: -5, h: 400 }, { x: Infinity, y: 0, w: 500, h: 400 }]) {
    expect(parseSaved(bad, win)).toEqual(dflt);
  }
});

test("TERM-060: a saved place from a bigger window is pulled inside a smaller one", () => {
  const r = parseSaved({ x: 1800, y: 1000, w: 900, h: 700 }, { w: 1000, h: 600 }).rect;
  expect(inside(r, { w: 1000, h: 600 })).toBe(true);
});

test("TERM-060: dragging cannot take the panel outside the window", () => {
  const r = { x: 100, y: 100, w: 600, h: 400 };
  expect(inside(moveBy(r, -500, -500, win))).toBe(true);
  expect(moveBy(r, -500, -500, win)).toMatchObject({ x: 0, y: 0 });
  const far = moveBy(r, 5000, 5000, win);
  expect(far.x + far.w).toBe(win.w);
  expect(far.y + far.h).toBe(win.h);
});

test("TERM-060: the panel may touch but not cover the macOS title bar", () => {
  expect(insetFor("MacIntel")).toBe(MAC_INSET);
  expect(insetFor("Win32")).toBe(0);
  const r = moveBy({ x: 10, y: 100, w: 600, h: 400 }, 0, -1000, win, MAC_INSET);
  expect(r.y).toBe(MAC_INSET); // touches the bar's lower edge
  expect(shown({ rect: r, maximized: true }, win, MAC_INSET).y).toBe(MAC_INSET);
});

test("TERM-060: resizing from an edge keeps the opposite edge and stops at the minimum size", () => {
  const r = { x: 300, y: 200, w: 600, h: 400 };
  expect(resizeBy(r, "e", 100, 0, win)).toEqual({ ...r, w: 700 });
  const w = resizeBy(r, "w", -80, 0, win);
  expect(w.x + w.w).toBe(r.x + r.w);
  expect(w.w).toBe(680);
  const tiny = resizeBy(r, "nw", 5000, 5000, win);
  expect(tiny.w).toBe(MIN.w);
  expect(tiny.h).toBe(MIN.h);
  expect(tiny.x + tiny.w).toBe(r.x + r.w);
  expect(tiny.y + tiny.h).toBe(r.y + r.h);
  expect(inside(resizeBy(r, "se", 9999, 9999, win))).toBe(true);
});

test("TERM-060: maximize fills the window and restore returns the normal rectangle", () => {
  const normal = { rect: { x: 100, y: 100, w: 600, h: 400 }, maximized: false };
  const big = toggleMaximize(normal);
  expect(shown(big, win)).toEqual({ x: 0, y: 0, w: win.w, h: win.h });
  expect(big.rect).toEqual(normal.rect);
  expect(shown(toggleMaximize(big), win)).toEqual(normal.rect);
  expect(parseSaved(toStored(big), win).maximized).toBe(true);
});

test("TERM-060: a press on a tab icon does not move the panel; the title bar does", () => {
  const icon = { closest: (sel: string) => (sel === "[data-nodrag]" ? {} : null) };
  const bar = { closest: () => null };
  expect(startsPanelMove(icon)).toBe(false);
  expect(startsPanelMove(bar)).toBe(true);
});

test("TERM-059: the button starts at the bottom right, keeps its saved place and stays inside a shrinking window", () => {
  const d = defaultButton(win);
  expect(d.x + BUTTON).toBeLessThanOrEqual(win.w);
  expect(d.x).toBeGreaterThan(win.w / 2);
  expect(d.y).toBeGreaterThan(win.h / 2);
  expect(parseButton({ x: 40, y: 60 }, win)).toEqual({ x: 40, y: 60 });
  expect(parseButton("junk", win)).toEqual(d);
  expect(parseButton({ x: "a", y: 1 }, win)).toEqual(d);
  const small = { w: 500, h: 300 };
  const c = clampButton({ x: 1300, y: 800 }, small);
  expect(c).toEqual({ x: small.w - BUTTON, y: small.h - BUTTON });
  expect(clampButton({ x: -20, y: -9 }, small)).toEqual({ x: 0, y: 0 });
});

test("TERM-060: a window smaller than the panel minimum still gives a rectangle that fits what it can", () => {
  const r = clampRect({ x: 0, y: 0, w: 900, h: 900 }, { w: 200, h: 150 });
  expect(r.w).toBeLessThanOrEqual(200);
  expect(r.h).toBeLessThanOrEqual(150);
});
