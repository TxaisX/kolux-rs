import { describe, expect, it } from "vitest";
import { add, addText, arrowHead, clear, describe as describeShapes, drawMessage, empty, finishDrag, fitScale, type Ink, MAX_SHAPES, MIN_DRAG, paint, redo, type Shape, strokeFor, TEXT_MAX, toolForKey, toPicture, undo } from "./draw";

describe("BROW-038 the drawing canvas's model", () => {
  it("a drag adds a shape; a click-sized drag and a full drawing add nothing", () => {
    const d = finishDrag(empty(), "rect", 50, 40, 10, 10);
    expect(d.shapes).toEqual([{ tool: "rect", x: 10, y: 10, w: 40, h: 30 }]);
    expect(finishDrag(d, "arrow", 5, 5, 5 + MIN_DRAG - 1, 5)).toBe(d);
    expect(finishDrag(d, "arrow", 5, 5, 5 + MIN_DRAG, 5).shapes).toHaveLength(2);
    const full = { shapes: Array.from({ length: MAX_SHAPES }, (): Shape => ({ tool: "rect", x: 0, y: 0, w: 9, h: 9 })), undone: [] };
    expect(finishDrag(full, "rect", 0, 0, 50, 50)).toBe(full);
    expect(addText(full, 1, 1, "x")).toBe(full);
  });

  it("text marks are folded to one line, capped, and a blank one adds nothing", () => {
    expect(addText(empty(), 3, 4, "  too \n  wide  ").shapes).toEqual([{ tool: "text", x: 3, y: 4, w: 0, h: 0, text: "too wide" }]);
    expect(addText(empty(), 3, 4, "   ")).toEqual(empty());
    expect(addText(empty(), 0, 0, "é".repeat(TEXT_MAX + 50)).shapes[0].text).toHaveLength(TEXT_MAX);
  });

  it("clear drops every shape and the redo list; undo then redo after a clear finds nothing", () => {
    const d = undo(add(add(empty(), { tool: "rect", x: 0, y: 0, w: 9, h: 9 }), { tool: "rect", x: 1, y: 1, w: 9, h: 9 }));
    expect(d.undone).toHaveLength(1);
    expect(clear()).toEqual({ shapes: [], undone: [] });
    expect(redo(undo(clear()))).toEqual(empty());
  });

  it("the keys pick the tool", () => {
    expect([toolForKey("r"), toolForKey("A"), toolForKey("t"), toolForKey("x"), toolForKey("Enter")]).toEqual(["rect", "arrow", "text", null, null]);
  });

  it("the picture is shown shrunk to fit and never enlarged; pointer points map back into it", () => {
    expect(fitScale(2000, 1000, 1000, 1000)).toBe(0.5);
    expect(fitScale(2000, 1000, 4000, 4000)).toBe(1);
    expect(fitScale(2000, 1000, 4000, 250)).toBe(0.25);
    expect(fitScale(0, 10, 10, 10)).toBe(1);
    expect(toPicture(100, 50, 0.5, 2000, 1000)).toEqual({ x: 200, y: 100 });
    expect(toPicture(-5, 99999, 0.5, 2000, 1000)).toEqual({ x: 0, y: 1000 });
  });

  it("an arrow's head sits at its tip, both barbs the same distance back", () => {
    const [a, b] = arrowHead({ tool: "arrow", x: 0, y: 0, w: 100, h: 0 }, 10);
    expect(a.x).toBeCloseTo(100 - 10 * Math.cos((28 * Math.PI) / 180));
    expect(b.x).toBeCloseTo(a.x);
    expect(a.y).toBeCloseTo(-b.y);
    expect(Math.hypot(a.x - 100, a.y)).toBeCloseTo(10);
    expect(strokeFor(1000)).toBe(2);
    expect(strokeFor(3840)).toBe(8);
  });

  it("export paints boxes, arrows and text in order with the drawing's ink", () => {
    const calls: string[] = [];
    const ctx = {
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 0,
      font: "",
      textBaseline: "alphabetic",
      strokeRect: (...a: number[]) => calls.push(`rect ${a.join(",")}`),
      beginPath: () => calls.push("begin"),
      moveTo: (x: number, y: number) => calls.push(`move ${x},${y}`),
      lineTo: (x: number, y: number) => calls.push(`line ${x},${y}`),
      stroke: () => calls.push("stroke"),
      fillText: (t: string, x: number, y: number) => calls.push(`text ${t} ${x},${y}`),
      measureText: (t: string) => ({ width: t.length * 10 }),
      fillRect: (...a: number[]) => calls.push(`chip ${a.join(",")}`),
    } as unknown as Ink;
    paint(ctx, [{ tool: "rect", x: 1, y: 2, w: 3, h: 4 }, { tool: "arrow", x: 0, y: 0, w: 50, h: 0 }, { tool: "text", x: 9, y: 9, w: 0, h: 0, text: "hi" }], 2);
    expect(ctx.lineWidth).toBe(2);
    expect(calls[0]).toBe("rect 1,2,3,4");
    expect(calls.slice(1, 3)).toEqual(["begin", "move 0,0"]);
    expect(calls).toContain("line 50,0");
    expect(calls.filter((c) => c === "stroke")).toHaveLength(1);
    expect(calls.slice(-2)).toEqual(["chip 9,9,28,18", "text hi 13,12"]);
    calls.length = 0;
    paint(ctx, [], 2);
    expect(calls).toEqual([]);
  });

  it("the message to the agent names the file, counts the marks and describes each one", () => {
    const shapes: Shape[] = [{ tool: "rect", x: 100, y: 50, w: 200, h: 100 }, { tool: "arrow", x: 400, y: 200, w: -100, h: -50 }, { tool: "text", x: 0, y: 500, w: 0, h: 0, text: "too wide" }];
    expect(describeShapes(shapes, 1000, 1000)).toEqual(["1. box 20% by 10% at 10% across, 5% down", "2. arrow from 40% across, 20% down to 30% across, 15% down", '3. text "too wide" at 0% across, 50% down']);
    const m = drawMessage({ title: "Shop", url: "https://shop.test/cart?token=abc#x", path: "C:/caps/shop-1.png", shapes, width: 1000, height: 1000 });
    expect(m.split("\n")[0]).toBe("Marked-up screenshot of Shop (https://shop.test/cart), 3 marks.");
    expect(m).toContain("Picture file: C:/caps/shop-1.png");
    expect(m).not.toContain("token");
    expect(drawMessage({ title: "", url: "http://a.test/", path: "p.png", shapes: [shapes[0]], width: 10, height: 10 })).toContain("1 mark.");
    expect(drawMessage({ title: "", url: "http://a.test/", path: "p.png", shapes: [], width: 10, height: 10 })).toBe("Marked-up screenshot of http://a.test/ (http://a.test/), 0 marks.\nPicture file: p.png\n");
  });
});
