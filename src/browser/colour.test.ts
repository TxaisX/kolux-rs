import { describe, expect, it } from "vitest";
import { rgbOf } from "./colour";

// BROW-011: the page's loading surface is painted in the pane's colour, read back from the
// computed style, which the browser always gives as rgb() or rgba().
describe("rgbOf", () => {
  it("reads an opaque computed colour", () => {
    expect(rgbOf("rgb(30, 31, 34)")).toEqual([30, 31, 34]);
    expect(rgbOf("rgba(250, 250, 249, 1)")).toEqual([250, 250, 249]);
  });
  it("has nothing for a transparent or unknown value", () => {
    expect(rgbOf("rgba(0, 0, 0, 0)")).toBeNull();
    expect(rgbOf("transparent")).toBeNull();
    expect(rgbOf("")).toBeNull();
  });
});
