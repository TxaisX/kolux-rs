import { describe, expect, it } from "vitest";
import { chatZoom, setChatZoom, stepZoom, zoomChord, zoomLabel } from "./zoom";

describe("CHAT-026 chat text zoom", () => {
  it("plus ten times stops at 1.6x and zero goes back to 1x", () => {
    let z = 1;
    for (let i = 0; i < 10; i++) z = stepZoom(z, "in");
    expect(z).toBe(1.6);
    expect(stepZoom(z, "reset")).toBe(1);
  });
  it("minus five times stops at 0.8x", () => {
    let z = 1;
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) seen.push((z = stepZoom(z, "out")));
    expect(seen).toEqual([0.9, 0.8, 0.8, 0.8, 0.8]);
  });
  it("the steps are whole tenths", () => {
    let z = 1;
    for (let i = 0; i < 6; i++) z = stepZoom(z, "in");
    expect(z).toBe(1.6);
    expect(stepZoom(1.1, "in")).toBe(1.2);
  });
  it("the chords: Ctrl or Cmd with plus, equals, minus, zero, and the number pad", () => {
    expect(zoomChord({ key: "=", ctrlKey: true })).toBe("in");
    expect(zoomChord({ key: "+", metaKey: true })).toBe("in");
    expect(zoomChord({ key: "Add", code: "NumpadAdd", ctrlKey: true })).toBe("in");
    expect(zoomChord({ key: "-", ctrlKey: true })).toBe("out");
    expect(zoomChord({ key: "Subtract", code: "NumpadSubtract", ctrlKey: true })).toBe("out");
    expect(zoomChord({ key: "0", ctrlKey: true })).toBe("reset");
  });
  it("plain keys, Alt chords and composing do nothing", () => {
    expect(zoomChord({ key: "=" })).toBeNull();
    expect(zoomChord({ key: "-", ctrlKey: true, altKey: true })).toBeNull();
    expect(zoomChord({ key: "0", ctrlKey: true, isComposing: true })).toBeNull();
    expect(zoomChord({ key: "a", ctrlKey: true })).toBeNull();
  });
  it("the zoom is kept in memory only and clamps", () => {
    setChatZoom(3);
    expect(chatZoom()).toBe(1.6);
    setChatZoom(0.1);
    expect(chatZoom()).toBe(0.8);
    setChatZoom(1);
    expect(zoomLabel(1.2)).toBe("1.2x");
  });
});
