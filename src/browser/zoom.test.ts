import { describe, expect, it } from "vitest";
import { nextZoom, zoomPercent } from "./zoom";

describe("BROW-012 tab zoom steps", () => {
  it("steps in and out through the browser steps and resets to 100%", () => {
    expect(nextZoom(1, "in")).toBe(1.1);
    expect(nextZoom(1.25, "in")).toBe(1.5);
    expect(nextZoom(1.5, "out")).toBe(1.25);
    expect(nextZoom(1.5, "reset")).toBe(1);
    expect(zoomPercent(1.5)).toBe("150%");
  });

  it("snaps a level between steps and stops at the limits", () => {
    expect(nextZoom(1.2, "in")).toBe(1.25);
    expect(nextZoom(1.2, "out")).toBe(1.1);
    expect(nextZoom(5, "in")).toBe(5);
    expect(nextZoom(0.25, "out")).toBe(0.25);
  });
});
