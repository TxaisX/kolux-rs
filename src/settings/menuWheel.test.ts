// SET-061 (T-323): which part of a menu the wheel scrolls.
import { describe, expect, it } from "vitest";
import { pixels, wheelTarget, type Box } from "./menuWheel";

const b = (overflowY: string, scrollTop: number, scrollHeight: number, clientHeight: number, parent: Box | null = null): Box => ({ overflowY, scrollTop, scrollHeight, clientHeight, parent });

describe("SET-061 wheel in menus", () => {
  it("the closest list that can scroll that way moves, not the menu or what is behind", () => {
    const menu = b("visible", 0, 300, 300);
    const list = b("auto", 0, 900, 200, menu);
    const row = b("visible", 0, 20, 20, list);
    expect(wheelTarget(row, 100)).toBe(list);
    expect(wheelTarget(row, -100)).toBeNull();
  });

  it("a list at its end passes the wheel out to a menu that can still scroll", () => {
    const menu = b("auto", 0, 800, 300);
    const list = b("auto", 700, 900, 200, menu);
    expect(wheelTarget(list, 50)).toBe(menu);
  });

  it("clipping and sideways-only parts are passed over; a short menu moves nothing", () => {
    const menu = b("hidden", 0, 900, 200);
    const side = b("visible", 0, 50, 50, menu);
    expect(wheelTarget(side, 100)).toBeNull();
    const short = b("auto", 0, 150, 150);
    expect(wheelTarget(short, 100)).toBeNull();
  });

  it("line and page wheels count in pixels", () => {
    expect(pixels(3, 1)).toBe(48);
    expect(pixels(1, 2, 400)).toBe(400);
    expect(pixels(30, 0)).toBe(30);
  });
});
