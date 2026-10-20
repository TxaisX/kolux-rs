// T-307-b: wheel reports in full-screen programs, the Shift hint, the scroll row kept over a tab switch.
import { describe, expect, it } from "vitest";
import { dragWantsHint, NOTCH_PX, shownAgain, WheelDrain, type WheelIn } from "./mouseFeel";
import { modeView, resetAfterExit } from "./modeReset";

const notch = (n = 1, mods: Partial<WheelIn> = {}): WheelIn => ({ deltaMode: 0, deltaY: n * NOTCH_PX, ctrlKey: false, altKey: false, ...mods });

function rig() {
  const sent: number[] = [];
  const frames: (() => void)[] = [];
  const d = new WheelDrain(
    (dir, n) => sent.push(dir * n),
    (f) => frames.push(f),
  );
  const tick = () => frames.shift()?.();
  return { d, sent, frames, tick };
}

describe("TERM-089 wheel in full-screen programs", () => {
  it("each notch reaches the program at once, scaled by the full-screen setting", () => {
    const { d, sent } = rig();
    d.push(notch(), 1, 5, 24);
    expect(sent).toEqual([1]);
    const r = rig();
    r.d.push(notch(-1), 3, 5, 24);
    expect(r.sent).toEqual([-3]);
  });
  it("the fast modifier scrolls several times further per notch", () => {
    const { d, sent } = rig();
    d.push(notch(1, { ctrlKey: true }), 1, 5, 24);
    expect(sent).toEqual([5]);
  });
  it("a fast burst drains: at most a capped batch per frame, the excess dropped, nothing left once the wheel stops", () => {
    const { d, sent, frames, tick } = rig();
    d.push(notch(), 1, 5, 24);
    for (let i = 0; i < 40; i++) d.push(notch(), 1, 5, 24); // 40 notches inside one frame
    tick();
    tick(); // the wheel has stopped
    expect(sent).toEqual([1, 2]);
    expect(frames).toHaveLength(0);
    d.push(notch(), 1, 5, 24); // idle again: the next notch goes out at once
    expect(sent).toEqual([1, 2, 1]);
  });
  it("trackpad steps add up to a notch; a turn the other way drops what was owed", () => {
    const { d, sent, tick } = rig();
    for (let i = 0; i < 4; i++) d.push({ deltaMode: 0, deltaY: 30, ctrlKey: false, altKey: false }, 1, 5, 24);
    expect(sent).toEqual([1]);
    d.push(notch(3), 1, 5, 24);
    d.push(notch(-1), 1, 5, 24);
    tick();
    expect(sent).toEqual([1, -1]);
  });
});

describe("TERM-088 selecting in programs that take the mouse", () => {
  it("a plain drag over a mouse-taking program brings the Shift hint; Shift, small moves and no capture do not", () => {
    expect(dragWantsHint("drag", false, 10, 0)).toBe(true);
    expect(dragWantsHint("drag", true, 10, 0)).toBe(false);
    expect(dragWantsHint("vt200", false, 2, 2)).toBe(false);
    expect(dragWantsHint("none", false, 40, 0)).toBe(false);
  });
  it("after replaying the history of a program that died with the mouse taken, the reset gives plain drags back", () => {
    const left = modeView({ mouseTrackingMode: "any", bracketedPasteMode: true });
    expect(resetAfterExit(left, false)).toContain("\x1b[?1003l");
  });
});

describe("TERM-091 scroll row kept over a tab switch", () => {
  it("bottom stays bottom; a row scrolled to comes back where its marker is; a trimmed row does nothing", () => {
    expect(shownAgain({ bottom: true, line: null }, 500)).toBe("bottom");
    expect(shownAgain({ bottom: false, line: 120 }, 500)).toBe(120);
    expect(shownAgain({ bottom: false, line: 900 }, 500)).toBe(500);
    expect(shownAgain({ bottom: false, line: -1 }, 500)).toBeNull();
  });
});
