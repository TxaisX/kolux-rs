// ACCT-060: terminal modes reset sensibly when an agent exits.
import { describe, expect, it } from "vitest";
import { modeView, resetAfterExit, type ModeView } from "./modeReset";

const quiet: ModeView = modeView(undefined);

describe("ACCT-060 mode reset at exit", () => {
  it("turns off the mouse protocols an agent left on, so a click in the shell prints no escape codes", () => {
    const s = resetAfterExit({ ...quiet, mouseTrackingMode: "any" }, false);
    for (const m of [1000, 1002, 1003, 1006]) expect(s).toContain(`\x1b[?${m}l`);
    expect(s.endsWith("\x1b[?25h")).toBe(true);
  });

  it("turns off bracketed paste and focus reporting only when they were on", () => {
    const s = resetAfterExit({ ...quiet, bracketedPasteMode: true, sendFocusMode: true }, false);
    expect(s).toBe("\x1b[?1004l\x1b[?2004l\x1b[?25h");
    expect(resetAfterExit(quiet, false)).toBe("\x1b[?25h");
  });

  it("leaves the alternate screen first when the program died on it, and ends a synchronized update", () => {
    const s = resetAfterExit({ ...quiet, synchronizedOutputMode: true }, true);
    expect(s.startsWith("\x1b[?1049l\x1b[?2026l")).toBe(true);
    expect(resetAfterExit(quiet, false)).not.toContain("1049");
  });

  it("always shows the cursor again: a restarted agent hides it itself while it runs", () => {
    expect(resetAfterExit(quiet, false)).toContain("\x1b[?25h");
    expect(resetAfterExit(quiet, false)).not.toContain("\x1b[?25l");
  });

  it("reads a missing or partial modes object as all off (a disposed terminal)", () => {
    expect(modeView(undefined)).toEqual(quiet);
    expect(modeView({ mouseTrackingMode: "vt200" }).mouseTrackingMode).toBe("vt200");
    expect(modeView({ mouseTrackingMode: "vt200" }).bracketedPasteMode).toBe(false);
  });
});
