import { describe, expect, it } from "vitest";
import { autoStarts, nextShown, place, prevShown, stepLabel, TOURS } from "./tour";

const base = { id: "tasks" as const, auto: true, seen: [], slotUsed: false, blocked: false, tried: [] };

describe("tour overlay (ONB-031)", () => {
  it("labels steps only when more than one shows and skips missing targets", () => {
    expect(stepLabel(0, 1)).toBeNull();
    expect(stepLabel(1, 3)).toBe("2 of 3");
    expect(nextShown([false, true, true], -1)).toBe(1);
    expect(nextShown([true, false, true], 0)).toBe(2);
    expect(nextShown([true, false], 0)).toBeNull();
    expect(prevShown([true, false, true], 2)).toBe(0);
    expect(prevShown([false, true], 1)).toBeNull();
  });

  it("sits on the preferred side, flips when there is no room and stays inside when nothing fits", () => {
    const b = { left: 0, top: 0, width: 1000, height: 800 };
    const p = { width: 300, height: 120 };
    expect(place({ left: 400, top: 100, width: 40, height: 20 }, p, b, "bottom")).toEqual({ side: "bottom", left: 270, top: 130 });
    expect(place({ left: 400, top: 760, width: 40, height: 20 }, p, b, "bottom").side).toBe("top");
    expect(place({ left: 2, top: 300, width: 40, height: 20 }, p, b, "right")).toEqual({ side: "right", left: 52, top: 250 });
    const r = place({ left: 0, top: 0, width: 1000, height: 800 }, p, b, "bottom");
    expect(r.side).toBeNull();
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.top).toBeGreaterThanOrEqual(0);
  });
});

describe("when tours start by themselves (ONB-032)", () => {
  it("only on a qualifying profile, once, one per launch, never over a dialog", () => {
    expect(autoStarts(base)).toBe(true);
    expect(autoStarts({ ...base, auto: false })).toBe(false);
    expect(autoStarts({ ...base, auto: null })).toBe(false);
    expect(autoStarts({ ...base, seen: ["tasks"] })).toBe(false);
    expect(autoStarts({ ...base, slotUsed: true })).toBe(false);
    expect(autoStarts({ ...base, blocked: true })).toBe(false);
  });
  it("offers the parallel tour only to someone who never split a pane (ONB-033)", () => {
    expect(autoStarts({ ...base, id: "parallel" })).toBe(true);
    expect(autoStarts({ ...base, id: "parallel", tried: ["split"] })).toBe(false);
  });
  it("has the catalogue the store keeps, translated", () => {
    expect(TOURS.map((t) => t.id)).toEqual(["tasks", "automations", "parallel"]);
    expect(TOURS.every((t) => t.steps.every((s) => s.ko.title && s.en.title))).toBe(true);
  });
});
