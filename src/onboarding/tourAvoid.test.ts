// ONB-031 / UX audit 2026-10-25 Part D: the floating-workspace tour must not cover a restored workspace pane.
import { describe, expect, it } from "vitest";
import { place, type Rect } from "./tour";

// 1400x880 viewport as measured: pane x 305-1092, y 84-848; float button at the bottom right.
const b: Rect = { left: 8, top: 8, width: 1384, height: 864 };
const pane: Rect = { left: 305, top: 84, width: 787, height: 764 };
const button: Rect = { left: 1348, top: 792, width: 44, height: 44 };
const p = { width: 320, height: 131 };
const hits = (a: Rect, w: number, h: number, o: Rect) => a.left < o.left + o.width && a.left + w > o.left && a.top < o.top + o.height && a.top + h > o.top;

describe("tour placement keeps off panes", () => {
  it("without panes to avoid, the step's own side wins (unchanged)", () => {
    expect(place(button, p, b, "left").side).toBe("left");
  });
  it("the left-of-button callout would cover the pane corner; with the pane given it does not", () => {
    const before = place(button, p, b, "left");
    expect(hits(before as unknown as Rect, p.width, p.height, pane)).toBe(true);
    const r = place(button, p, b, "left", [pane]);
    expect(hits({ left: r.left, top: r.top, width: 0, height: 0 }, r.width ?? p.width, p.height, pane)).toBe(false);
    expect(r.left + (r.width ?? p.width)).toBeLessThanOrEqual(b.left + b.width);
  });
  it("when every side would cover a pane, the old placement stands", () => {
    const wide = { left: 0, top: 0, width: 1400, height: 880 };
    expect(place(button, p, b, "left", [wide])).toEqual(place(button, p, b, "left"));
  });
});
