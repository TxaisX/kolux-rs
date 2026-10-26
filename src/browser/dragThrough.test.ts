import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import src from "./BrowserPane.tsx?raw";
import install from "./dragThroughInstall.ts?raw";
import { createDragGate, createSeq, DRAG_SLOP, GRACE_MS, installDragThrough, RENEW_MS } from "./dragThrough";

describe("BROW-052: the drag gate", () => {
  it("tells the back end once when a drag starts and once when it ends", () => {
    const sent: boolean[] = [];
    const g = createDragGate((on) => sent.push(on));
    g.begin("html5");
    g.begin("pointer");
    expect(sent).toEqual([true]);
    g.end("html5");
    expect(g.on).toBe(true);
    g.end("pointer");
    expect(sent).toEqual([true, false]);
    expect(g.on).toBe(false);
  });

  it("an end with no drag, or a repeated end, says nothing", () => {
    const sent: boolean[] = [];
    const g = createDragGate((on) => sent.push(on));
    g.end("html5");
    g.reset();
    g.begin("pointer");
    g.end("pointer");
    g.end("pointer");
    expect(sent).toEqual([true, false]);
  });

  it("reset ends every kind at once", () => {
    const sent: boolean[] = [];
    const g = createDragGate((on) => sent.push(on));
    g.begin("html5");
    g.begin("pointer");
    g.reset();
    expect(sent).toEqual([true, false]);
  });

  it("renew repeats the start only while a drag is going", () => {
    const sent: boolean[] = [];
    const g = createDragGate((on) => sent.push(on));
    g.renew();
    expect(sent).toEqual([]);
    g.begin("html5");
    g.renew();
    g.end("html5");
    g.renew();
    expect(sent).toEqual([true, true, false]);
  });
});

describe("BROW-052: the window's events drive the gate", () => {
  let win: EventTarget;
  let sent: boolean[];
  let clock: number;
  let stop: () => void;
  const last = () => sent[sent.length - 1];
  const fire = (type: string, props: Record<string, unknown> = {}) => win.dispatchEvent(Object.assign(new Event(type), props));
  beforeEach(() => {
    vi.useFakeTimers();
    win = new EventTarget();
    sent = [];
    clock = 1_000;
    stop = installDragThrough(win, (on) => sent.push(on), () => clock);
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it("starts by telling the back end no drag is under way (heals a reload)", () => {
    expect(sent).toEqual([false]);
  });

  it("a dragged tab or file: dragstart lets pages through, dragend gives them back", () => {
    fire("dragstart");
    expect(sent).toEqual([false, true]);
    fire("dragend");
    expect(sent).toEqual([false, true, false]);
  });

  it("a drag whose source was removed ends on the drop", () => {
    fire("dragstart");
    fire("drop");
    expect(last()).toBe(false);
  });

  it("a cancelled drag (Esc) ends even without a dragend", () => {
    fire("dragstart");
    fire("keydown", { key: "Escape" });
    expect(last()).toBe(false);
  });

  it("other keys do not end a drag", () => {
    fire("dragstart");
    fire("keydown", { key: "a" });
    expect(last()).toBe(true);
  });

  it("a drag released outside the window ends on the next mouse event with no button down", () => {
    fire("dragstart");
    clock += GRACE_MS + 1;
    fire("pointermove", { buttons: 0, clientX: 5, clientY: 5 });
    expect(last()).toBe(false);
  });

  it("a mouse event right at the start of a drag is its start-up, not its end", () => {
    fire("dragstart");
    clock += 10;
    fire("pointermove", { buttons: 0 });
    expect(last()).toBe(true);
  });

  it("losing the window's focus ends a drag, but not in its first instant", () => {
    fire("dragstart");
    fire("blur");
    expect(last()).toBe(true);
    clock += GRACE_MS + 1;
    fire("blur");
    expect(last()).toBe(false);
  });

  it("the window going hidden ends a drag", () => {
    fire("dragstart");
    fire("visibilitychange");
    expect(last()).toBe(false);
  });

  it("a splitter drag: press, move past the slop, release", () => {
    fire("pointerdown", { button: 0, clientX: 100, clientY: 100 });
    fire("pointermove", { buttons: 1, clientX: 100 + DRAG_SLOP - 2, clientY: 100 });
    expect(sent).toEqual([false]);
    fire("pointermove", { buttons: 1, clientX: 100 + DRAG_SLOP + 4, clientY: 100 });
    expect(sent).toEqual([false, true]);
    fire("pointerup");
    expect(sent).toEqual([false, true, false]);
  });

  it("a click that never moves lets nothing through", () => {
    fire("pointerdown", { button: 0, clientX: 10, clientY: 10 });
    fire("pointerup");
    expect(sent).toEqual([false]);
  });

  it("a pointer drag ends on cancel and on lost capture", () => {
    for (const end of ["pointercancel", "lostpointercapture"]) {
      fire("pointerdown", { button: 0, clientX: 0, clientY: 0 });
      fire("pointermove", { buttons: 1, clientX: 50, clientY: 0 });
      expect(last()).toBe(true);
      fire(end);
      expect(last()).toBe(false);
    }
  });

  it("a pointer drag whose release was missed ends on the next move with no button down", () => {
    fire("pointerdown", { button: 0, clientX: 0, clientY: 0 });
    fire("pointermove", { buttons: 1, clientX: 50, clientY: 0 });
    fire("pointermove", { buttons: 0, clientX: 60, clientY: 0 });
    expect(last()).toBe(false);
  });

  it("the browser cancelling the pointer when an HTML5 drag starts does not end that drag", () => {
    fire("pointerdown", { button: 0, clientX: 0, clientY: 0 });
    fire("dragstart");
    fire("pointercancel");
    expect(last()).toBe(true);
    fire("dragend");
    expect(last()).toBe(false);
  });

  it("a right-button press never starts a pointer drag", () => {
    fire("pointerdown", { button: 2, clientX: 0, clientY: 0 });
    fire("pointermove", { buttons: 2, clientX: 80, clientY: 0 });
    expect(sent).toEqual([false]);
  });

  it("a drag that lasts is told again every renewal, and the timer stops with it", () => {
    fire("dragstart");
    for (let i = 0; i < 2; i++) {
      fire("dragover");
      vi.advanceTimersByTime(RENEW_MS);
    }
    vi.advanceTimersByTime(5);
    expect(sent.filter(Boolean).length).toBe(3);
    fire("dragend");
    const n = sent.length;
    vi.advanceTimersByTime(RENEW_MS * 3);
    expect(sent.length).toBe(n);
  });

  it("no drag activity across a renewal tick resets the gate and tells the back end on=false", () => {
    fire("dragstart");
    vi.advanceTimersByTime(RENEW_MS + 5);
    expect(sent).toEqual([false, true, false]);
    const n = sent.length;
    vi.advanceTimersByTime(RENEW_MS * 3);
    expect(sent.length).toBe(n);
  });

  it("dragover, drag and a button-down move each count as activity for the next renewal", () => {
    for (const [type, props] of [
      ["dragover", {}],
      ["drag", {}],
      ["pointermove", { buttons: 1, clientX: 0, clientY: 0 }],
    ] as const) {
      sent.length = 0;
      fire("dragstart");
      fire(type, props);
      vi.advanceTimersByTime(RENEW_MS + 5);
      expect(sent, type).toEqual([true, true]);
      fire("dragend");
    }
  });

  it("activity seen before one tick does not carry over to the next", () => {
    fire("dragstart");
    fire("dragover");
    vi.advanceTimersByTime(RENEW_MS);
    expect(last()).toBe(true);
    vi.advanceTimersByTime(RENEW_MS);
    expect(last()).toBe(false);
  });

  it("a button-less move is not activity", () => {
    fire("dragstart");
    vi.advanceTimersByTime(RENEW_MS - 1);
    clock += GRACE_MS + 1;
    fire("pointermove", { buttons: 0 });
    expect(last()).toBe(false);
  });

  it("stopping the watcher gives the pages back", () => {
    fire("dragstart");
    stop();
    expect(last()).toBe(false);
    fire("dragstart");
    expect(last()).toBe(false);
  });
});

describe("BROW-052: call numbers", () => {
  it("grow with every call, even inside one clock tick", () => {
    const next = createSeq(() => 100);
    expect([next(), next(), next()]).toEqual([100, 101, 102]);
  });

  it("a reloaded window starts above the old one", () => {
    const old = createSeq(() => 1_000);
    old();
    old();
    const fresh = createSeq(() => 5_000);
    expect(fresh()).toBeGreaterThan(old());
  });
});

describe("BROW-052: wiring", () => {
  it("BrowserPane imports the installer so drags are watched from start-up", () => {
    expect(src).toContain('import "./dragThroughInstall"');
  });

  it("the installer numbers every browser_drag_through call", () => {
    expect(install).toMatch(/browser_drag_through",\s*\{\s*on,\s*seq: nextSeq\(\)/);
  });
});
