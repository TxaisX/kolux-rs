import { describe, expect, test, vi } from "vitest";

let deliver: ((e: { payload: number }) => void) | null = null;
const unlisten = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event: string, cb: (e: { payload: number }) => void) => {
    deliver = cb;
    return unlisten;
  }),
}));

import { heldListen, Hold, HOLD_CAP, REPLAY_SLICE, repaint, type Doc } from "./hidden";

function fakeDoc(hidden = false) {
  const fns = new Set<() => void>();
  const doc: Doc & { show(): void; hide(): void; listeners: number } = {
    hidden,
    addEventListener: (_t, f) => void fns.add(f),
    removeEventListener: (_t, f) => void fns.delete(f),
    show() {
      this.hidden = false;
      for (const f of fns) f();
    },
    hide() {
      this.hidden = true;
      for (const f of fns) f();
    },
    get listeners() {
      return fns.size;
    },
  };
  return doc;
}

describe("T-286-b APP-017: updates for a hidden window are held and replayed when it is shown", () => {
  test("shown: applied at once; hidden: held, then replayed in order on show", () => {
    const doc = fakeDoc();
    const seen: number[] = [];
    const h = new Hold<number>((v) => seen.push(v), { doc });
    h.push(1);
    expect(seen).toEqual([1]);
    doc.hide();
    h.push(2);
    h.push(3);
    expect(seen).toEqual([1]);
    expect(h.held).toBe(2);
    doc.show();
    expect(seen).toEqual([1, 2, 3]);
    expect(h.held).toBe(0);
    h.dispose();
    expect(doc.listeners).toBe(0);
  });

  test("a latest-only stream replays just the newest value", () => {
    const doc = fakeDoc(true);
    const seen: string[] = [];
    const h = new Hold<string>((v) => seen.push(v), { doc, latestOnly: true });
    for (const v of ["a", "b", "c"]) h.push(v);
    doc.show();
    expect(seen).toEqual(["c"]);
  });

  test("a long backlog replays in slices so a burst never freezes the window, and stays capped", () => {
    const doc = fakeDoc(true);
    const seen: number[] = [];
    const frames: (() => void)[] = [];
    const h = new Hold<number>((v) => seen.push(v), { doc, later: (f) => frames.push(f) });
    for (let i = 0; i < REPLAY_SLICE * 2 + 5; i++) h.push(i);
    doc.show();
    expect(seen.length).toBe(REPLAY_SLICE);
    while (frames.length) frames.shift()!();
    expect(seen.length).toBe(REPLAY_SLICE * 2 + 5);
    expect(seen.every((v, i) => v === i)).toBe(true);
    const capped = new Hold<number>(() => {}, { doc: fakeDoc(true), cap: 3 });
    for (let i = 0; i < 10; i++) capped.push(i);
    expect(capped.held).toBe(3);
    expect(HOLD_CAP).toBeGreaterThan(REPLAY_SLICE);
  });

  test("heldListen wraps Tauri's listen and unlistening ends the hold", async () => {
    const doc = fakeDoc(true);
    const seen: number[] = [];
    const off = await heldListen<number>("claude-usage", (e) => seen.push(e.payload), { doc });
    deliver!({ payload: 7 });
    expect(seen).toEqual([]);
    doc.show();
    expect(seen).toEqual([7]);
    off();
    expect(unlisten).toHaveBeenCalledOnce();
    expect(doc.listeners).toBe(0);
  });

  test("after a wake the page replays every hold, re-lays out and repaints", () => {
    const doc = fakeDoc(true);
    const seen: number[] = [];
    const h = new Hold<number>((v) => seen.push(v), { doc });
    h.push(1);
    const events: string[] = [];
    const root = { style: { transform: "" } };
    const frames: (() => void)[] = [];
    repaint({ dispatchEvent: (e: Event) => (events.push(e.type), true) }, root, (f) => frames.push(f));
    expect(seen).toEqual([1]);
    expect(events).toEqual(["resize"]);
    expect(root.style.transform).toBe("translateZ(0)");
    frames.shift()!();
    expect(root.style.transform).toBe("");
    h.dispose();
  });
});
