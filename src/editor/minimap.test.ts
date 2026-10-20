import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { sampleDoc, scrollForClick, viewBox } from "./minimap";

// EDIT-006 (T-316-b): the numbers behind the minimap picture. The canvas drawing itself is live-proof only.
const doc = (s: string) => Text.of(s.split("\n"));

describe("squeezing a file into rows", () => {
  it("one row per line while there is room, bars as long and as indented as the text", () => {
    const rows = sampleDoc(doc("abc\n    indented\n\n\tTabbed"), 10);
    expect(rows).toEqual([
      { indent: 0, length: 3 },
      { indent: 4, length: 12 },
      { indent: 0, length: 0 },
      { indent: 4, length: 10 },
    ]);
  });

  it("a long file shares rows between lines: the least indent and the longest line win", () => {
    const lines = Array.from({ length: 100 }, (_, i) => (i === 41 ? "        deep line of text here" : i % 2 ? "  x" : "yy"));
    const rows = sampleDoc(Text.of(lines), 10);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toEqual({ indent: 0, length: 2 }); // a ten-line bucket looks at every other line, here the "yy" ones
    expect(rows.every((r) => r.indent <= 8 && r.length <= 100)).toBe(true);
  });

  it("empty or zero-row cases give nothing, and very long lines are capped", () => {
    expect(sampleDoc(doc("a"), 0)).toEqual([]);
    expect(sampleDoc(doc(""), 5)).toEqual([{ indent: 0, length: 0 }]);
    expect(sampleDoc(doc("x".repeat(500)), 5)[0].length).toBe(100);
  });
});

describe("the lit box and clicking", () => {
  it("the box covers the window's share of the picture and follows the scroll", () => {
    // page 4000px tall in a 1000px window, picture 400px tall: ten page pixels per picture pixel
    expect(viewBox(0, 1000, 4000, 400)).toEqual({ top: 0, height: 100 });
    expect(viewBox(1500, 1000, 4000, 400)).toEqual({ top: 150, height: 100 });
    expect(viewBox(3000, 1000, 4000, 400)).toEqual({ top: 300, height: 100 });
  });

  it("a short file fills the picture it has and never leaves it", () => {
    expect(viewBox(0, 1000, 600, 100)).toEqual({ top: 0, height: 100 });
    expect(viewBox(99999, 1000, 4000, 400).top).toBe(300);
  });

  it("a click centres that spot in the window and stays inside the page", () => {
    expect(scrollForClick(200, 1000, 4000, 400)).toBe(1500); // 2000px down, minus half a window
    expect(scrollForClick(0, 1000, 4000, 400)).toBe(0);
    expect(scrollForClick(400, 1000, 4000, 400)).toBe(3000); // the end of the page, not past it
    expect(scrollForClick(50, 1000, 600, 100)).toBe(0); // nothing to scroll
  });
});
