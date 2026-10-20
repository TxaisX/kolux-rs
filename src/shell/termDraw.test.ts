import { describe, expect, it } from "vitest";
import { optionsOf, readText } from "../terminal/text";
import { drawOptions, inactiveCursor } from "./termDraw";

describe("TERM-101 cursor style when the pane is not focused", () => {
  it("is hollow only for the block style", () => {
    expect(inactiveCursor("block")).toBe("outline");
    expect(inactiveCursor("bar")).toBe("bar");
    expect(inactiveCursor("underline")).toBe("underline");
  });
  it("reaches the terminal options with the chosen style, blink and bar persisted", () => {
    const o = optionsOf(readText({ terminalCursorStyle: "bar", terminalCursorBlink: false }));
    expect([o.cursorStyle, o.cursorBlink, o.cursorInactiveStyle]).toEqual(["bar", false, "bar"]);
    const d = optionsOf(readText({}));
    expect([d.cursorStyle, d.cursorBlink, d.cursorInactiveStyle]).toEqual(["block", true, "outline"]);
  });
  it("an unknown saved style falls back to block", () => {
    expect(optionsOf(readText({ terminalCursorStyle: "beam" })).cursorStyle).toBe("block");
  });
});

describe("TERM-104 wide text and emoji", () => {
  it("squeezes overlapping glyphs back into their cells", () => {
    expect(drawOptions("block").rescaleOverlappingGlyphs).toBe(true);
    expect(optionsOf(readText({})).rescaleOverlappingGlyphs).toBe(true);
  });
});
