import { describe, expect, it } from "vitest";
import { claimsClick } from "./linkClick";
import { replay, encodeHistory } from "./history";

// TERM-092 (T-222-c): link clicks are not sent on to a program that captures the mouse.
const press = (o: Partial<Parameters<typeof claimsClick>[0]> = {}) => ({ button: 0, ctrlKey: false, metaKey: false, shiftKey: false, ...o });

describe("link click vs a mouse-capturing program", () => {
  it("Ctrl+click (Cmd on macOS) is Kolux's while a program tracks the mouse", () => {
    for (const mode of ["x10", "vt200", "drag", "any"]) {
      expect(claimsClick(press({ ctrlKey: true }), false, mode)).toBe(true);
      expect(claimsClick(press({ metaKey: true }), true, mode)).toBe(true);
    }
  });

  it("a plain click, the wrong modifier or another button is still the program's", () => {
    expect(claimsClick(press(), false, "any")).toBe(false);
    expect(claimsClick(press({ metaKey: true }), false, "any")).toBe(false);
    expect(claimsClick(press({ ctrlKey: true }), true, "any")).toBe(false);
    expect(claimsClick(press({ ctrlKey: true, button: 2 }), false, "any")).toBe(false);
  });

  it("nothing is claimed when no program tracks the mouse, or with Shift (xterm never forwards a shifted press)", () => {
    expect(claimsClick(press({ ctrlKey: true }), false, "none")).toBe(false);
    expect(claimsClick(press({ ctrlKey: true, shiftKey: true }), false, "any")).toBe(false);
  });
});

describe("a program's own links after a restore", () => {
  it("the saved transcript is replayed with its OSC 8 hyperlink sequences intact, so the link is rebuilt", () => {
    const out = "see \x1b]8;;file:///C:/w/src/app.ts\x1b\app.ts\x1b]8;;\x1b\ and \x1b]8;id=1;https://example.com/a\x07docs\x1b]8;;\x07\r\n";
    expect(replay(encodeHistory(out))).toBe(out);
  });

  it("the terminal's own answers are still dropped from a replay", () => {
    expect(replay(encodeHistory("a\x1b[6nb\x1b]8;;https://x.y\x07l\x1b]8;;\x07"))).toBe("ab\x1b]8;;https://x.y\x07l\x1b]8;;\x07");
  });
});
