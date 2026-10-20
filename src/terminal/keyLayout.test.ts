// VIEW-109 (T-253): shortcut labels use the layout's characters.
import { afterEach, describe, expect, it } from "vitest";
import { chordKeyCode, currentLayout, LAYOUT_EVENT, layoutKeyLabel, resetLayout, watchLayout, type LayoutMap } from "./keyLayout";

// German (QWERTZ): Y and Z swap, the US slash key types -, the US minus key types ß, the US semicolon key types ö.
const german: LayoutMap = new Map(Object.entries({ KeyY: "z", KeyZ: "y", KeyA: "a", Slash: "-", Minus: "ß", Semicolon: "ö", Digit7: "7", Space: " " }));

afterEach(() => resetLayout());

describe("VIEW-109 layout labels", () => {
  it("German layout: a punctuation chord is labelled with the key the layout prints at its position; letters already match the printed key", () => {
    expect(layoutKeyLabel("Z", german, "Z")).toBe("Z");
    expect(layoutKeyLabel("Y", german, "Y")).toBe("Y");
    expect(layoutKeyLabel("Slash", german, "/")).toBe("-");
    expect(layoutKeyLabel("Minus", german, "-")).toBe("ß");
    expect(layoutKeyLabel("Semicolon", german, ";")).toBe("Ö");
    expect(layoutKeyLabel("7", german, "7")).toBe("7");
  });
  it("keys whose label never depends on the layout, an unknown layout and a blank key keep the US label", () => {
    expect(layoutKeyLabel("ArrowUp", german, "Up")).toBe("Up");
    expect(layoutKeyLabel("F5", german, "F5")).toBe("F5");
    expect(layoutKeyLabel("Slash", null, "/")).toBe("/");
    expect(layoutKeyLabel("Quote", german, "'")).toBe("'"); // not in the map
    expect(chordKeyCode("Enter")).toBeNull();
    expect(chordKeyCode("BracketLeft")).toBe("BracketLeft");
  });
  it("the watcher reads the layout, again on a layout change, and tells open labels", async () => {
    const listeners: Record<string, () => void> = {};
    let maps = [new Map([["Slash", "/"]]), german];
    const keyboard = { getLayoutMap: async () => maps.shift() as LayoutMap, addEventListener: (t: string, fn: () => void) => void (listeners[t] = fn), removeEventListener: () => {} };
    const fired: string[] = [];
    const win = { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: (e: Event) => (fired.push(e.type), true) };
    const stop = watchLayout(keyboard, win);
    await Promise.resolve();
    await Promise.resolve();
    expect(layoutKeyLabel("Slash", currentLayout(), "/")).toBe("/");
    listeners.layoutchange();
    await Promise.resolve();
    await Promise.resolve();
    expect(layoutKeyLabel("Slash", currentLayout(), "/")).toBe("-");
    expect(fired).toEqual([LAYOUT_EVENT, LAYOUT_EVENT]);
    stop();
    maps = [];
  });
  it("no layout API: nothing breaks and the US labels stay", () => {
    expect(() => watchLayout(undefined, undefined)()).not.toThrow();
    expect(currentLayout()).toBeNull();
  });
});
