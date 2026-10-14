import { describe, expect, it } from "vitest";
import { nextLevel, percentOf, readZoom } from "./zoom";

describe("interface zoom (SET-019)", () => {
  it("steps half a level, about 9.5 %, and two steps make one whole level of 1.2", () => {
    expect(percentOf(nextLevel(0, "in"))).toBe(110);
    expect(percentOf(nextLevel(nextLevel(0, "in"), "in"))).toBe(120);
    expect(percentOf(nextLevel(0, "out"))).toBe(91);
  });
  it("holds between -3 and +5 levels and resets to 100 % from anywhere", () => {
    expect(nextLevel(5, "in")).toBe(5);
    expect(nextLevel(-3, "out")).toBe(-3);
    expect(percentOf(-3)).toBe(58);
    expect(percentOf(5)).toBe(249);
    expect(nextLevel(4.5, "reset")).toBe(0);
  });
  it("reads a saved level back on a half step inside the range, anything else as 100 %", () => {
    expect(readZoom(1.5)).toBe(1.5);
    expect(readZoom(1.3)).toBe(1.5);
    expect(readZoom(40)).toBe(5);
    expect(readZoom("2")).toBe(0);
    expect(readZoom(Number.NaN)).toBe(0);
  });
});
