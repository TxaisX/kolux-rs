import { describe, expect, it } from "vitest";
import { add, dismissHint, empty, hintSeen, normalise, PIXEL_BUDGET, redo, sizes, undo } from "./draw";

describe("BROW-038 drawing rules", () => {
  it("adds, undoes and redoes shapes; a new shape drops the undone ones", () => {
    const a = { tool: "rect" as const, x: 1, y: 1, w: 2, h: 2 };
    const b = { tool: "text" as const, x: 5, y: 5, w: 0, h: 0, text: "here" };
    let d = add(add(empty(), a), b);
    expect(d.shapes).toEqual([a, b]);
    d = undo(d);
    expect(d.shapes).toEqual([a]);
    expect(d.undone).toEqual([b]);
    expect(redo(d).shapes).toEqual([a, b]);
    expect(undo(undo(undo(d)))).toEqual({ shapes: [], undone: [b, a] });
    expect(add(d, a).undone).toEqual([]);
    expect(redo(empty())).toEqual(empty());
  });

  it("a drag in any direction is a box with a positive size; an arrow keeps its direction", () => {
    expect(normalise("rect", 10, 10, 2, 4)).toEqual({ tool: "rect", x: 2, y: 4, w: 8, h: 6 });
    expect(normalise("arrow", 10, 10, 2, 4)).toEqual({ tool: "arrow", x: 10, y: 10, w: -8, h: -6 });
  });

  it("picks capture scales within the pixel budget, the display's own first", () => {
    expect(sizes(1920, 1080, 2)).toEqual([2, 1]);
    expect(sizes(3840, 2160, 2)).toEqual([1]);
    expect(sizes(800, 600, 3.6)).toEqual([4, 3, 2, 1]);
    expect(sizes(800, 600, 0.5)).toEqual([1]);
    expect(sizes(8000, 8000, 1)).toEqual([1]);
    expect(1920 * 1080 * 4 <= PIXEL_BUDGET).toBe(true);
  });

  it("shows the hint once per browser", () => {
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(hintSeen(s)).toBe(false);
    dismissHint(s);
    expect(hintSeen(s)).toBe(true);
    expect(hintSeen(null)).toBe(false);
    expect(hintSeen({ getItem: () => { throw new Error("blocked"); } })).toBe(true);
    expect(() => dismissHint({ setItem: () => { throw new Error("blocked"); } })).not.toThrow();
  });
});
