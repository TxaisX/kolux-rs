// ONB-027 / UX audit 2026-10-25 fix 10: the startup Tip sits over the sidebar column, not on a restored terminal grid.
import { describe, expect, it } from "vitest";
import type { CSSProperties } from "react";
import { tipDock } from "./Guides";
import type { Rect } from "./tour";

const vp = { width: 1600, height: 900 };
const statusTop = 876;
const sidebar: Rect = { left: 0, top: 0, width: 289, height: 876 };
// A restored full-width grid: one pane right of the sidebar, down to the status bar.
const pane: Rect = { left: 289, top: 0, width: 1311, height: 876 };
const H = 200;

// The Tip card's rect from its dock style (height from the measured card).
function rectOf(s: CSSProperties): Rect {
  const width = typeof s.width === "number" ? s.width : Math.min(420, vp.width - 32);
  const left = typeof s.left === "number" ? s.left : vp.width - (s.right as number) - width;
  return { left, top: vp.height - (s.bottom as number) - H, width, height: H };
}
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));

describe("tipDock", () => {
  it("over a full-width grid the Tip sits in the sidebar column: 0 px on the pane, 0 px on the status bar", () => {
    const r = rectOf(tipDock(sidebar, statusTop, vp));
    expect(overlap(r, pane)).toBe(0);
    expect(overlap(r, { left: 0, top: statusTop, width: vp.width, height: 24 })).toBe(0);
    expect(r.width).toBeGreaterThanOrEqual(240);
    expect(r.width).toBeLessThanOrEqual(sidebar.width);
    expect(r.left).toBeGreaterThanOrEqual(0);
  });
  it("no sidebar: the same bottom-right style as before", () => {
    expect(tipDock(null, statusTop, vp)).toEqual({ right: 16, bottom: 40 });
  });
  it("a sidebar narrower than 240 px keeps the bottom-right placement", () => {
    expect(tipDock({ ...sidebar, width: 239 }, statusTop, vp)).toEqual({ right: 16, bottom: 40 });
    expect(tipDock({ ...sidebar, left: -289 }, statusTop, vp)).toEqual({ right: 16, bottom: 40 });
  });
  it("a wide sidebar caps the Tip at 420 px", () => {
    expect(rectOf(tipDock({ ...sidebar, width: 600 }, statusTop, vp)).width).toBe(420);
  });
});
