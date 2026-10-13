// TERM-106: a reopened pane shows what it printed before the restart above a fresh shell.
import { describe, expect, it } from "vitest";
import { encodeHistory, NOTE, placeNote, replay, RESET, restoreTail, viewTop } from "./history";

const buf = (lines: string[], baseY = 0) => ({ length: lines.length, baseY, getLine: (y: number) => (y < lines.length ? { translateToString: () => lines[y] } : undefined) });

describe("replay (TERM-106)", () => {
  it("writes nothing when nothing was saved", () => {
    expect(replay("")).toBeNull();
  });

  it("gives the saved bytes back as text", () => {
    expect(replay(btoa("$ echo hi\r\nhi\r\n"))).toBe("$ echo hi\r\nhi\r\n");
  });

  it("drops the questions whose answers would be typed into the new shell", () => {
    // ConPTY asks for the cursor position and turns focus reporting on at every shell start.
    const saved = "a\x1b[6nb\x1b[?1004hc\x1b[>0qd\x1b]11;?\x07e\x1b[?25h";
    expect(replay(btoa(saved))).toBe("abcde\x1b[?25h");
  });
});

describe("placeNote (TERM-106)", () => {
  it("lands under the last row with text", () => {
    expect(placeNote(buf(["PS> echo hi", "hi", "PS>", "", ""]), 5)).toBe("\x1b[3;1H\r\n");
  });

  it("scrolls when the last text sits on the bottom row", () => {
    expect(placeNote(buf(["a", "b", "c"]), 3)).toBe("\x1b[3;1H\r\n");
  });

  it("starts at the top of a blank screen, also when the text is all in the scrollback", () => {
    expect(placeNote(buf(["", ""]), 2)).toBe("\x1b[1;1H");
    expect(placeNote(buf(["old", "", ""], 1), 2)).toBe("\x1b[1;1H");
  });
});

describe("restoreTail (TERM-106)", () => {
  it("resets the screen, writes the note under the last text, pushes the screen up and parks the cursor at the top", () => {
    expect(restoreTail(buf(["PS>", "", ""]), 3)).toBe(RESET + "\x1b[1;1H\r\n" + NOTE + "\r\n\r\n\r\n" + "\x1b[H");
    expect(RESET).toContain("\x1b[?1049l"); // leaves a full-screen program's screen behind
    expect(RESET).toContain("\x1b[?25h"); // shows the cursor again
  });

  it("goes into the transcript as the terminal took it", () => {
    expect(replay(encodeHistory(NOTE))).toBe(NOTE);
  });
});

describe("viewTop (TERM-106)", () => {
  it("puts the prompt row last in view, with the note and the old output above it", () => {
    expect(viewTop({ baseY: 53 }, 47)).toBe(7);
  });

  it("never scrolls above the first row", () => {
    expect(viewTop({ baseY: 3 }, 47)).toBe(0);
  });
});
