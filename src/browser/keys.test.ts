import { describe, expect, it } from "vitest";
import { defaultsOnly, matchEvent, resolve } from "../keys/keymap";
import { keyEventInit, pageKeys, startsGrab } from "./keys";

describe("BROW-018 app shortcuts forwarded from a page", () => {
  it("the page forwards the tab, browser and global chords, never the page's editing chords or unmodified keys", () => {
    const keys = pageKeys(defaultsOnly("win32"));
    const has = (k: Partial<ReturnType<typeof pageKeys>[number]>) => keys.some((d) => Object.entries(k).every(([f, v]) => (d as Record<string, unknown>)[f] === v) && Object.keys(d).length === Object.keys(k).length);
    expect(has({ c: 1, k: "Tab" })).toBe(true); // tab.previousRecent
    expect(has({ c: 1, k: "W" })).toBe(true); // tab.close
    expect(has({ c: 1, s: 1, k: "B" })).toBe(true); // tab.newBrowser
    expect(has({ a: 1, k: "1", i: 1 })).toBe(true); // tab.selectByIndex takes any digit
    expect(has({ c: 1, k: "F" })).toBe(true); // browser.find
    expect(has({ a: 1, k: "ArrowLeft" })).toBe(true); // browser.back
    expect(has({ c: 1, k: "C", n: 1 })).toBe(true); // browser.grabElement is Mod+C: the app's only while nothing is selected
    for (const k of ["V", "X", "A", "Z", "Y"]) expect(keys.some((d) => d.k === k && d.c && !d.a)).toBe(false); // the page keeps the other editing chords
    expect(keys.some((d) => !d.c && !d.m && !d.a)).toBe(false);
    expect(new Set(keys.map((d) => JSON.stringify(d))).size).toBe(keys.length);
  });

  it("a customised binding is forwarded in place of the default, and a Mac chord uses the command key", () => {
    const custom = resolve({ "browser.find": ["Mod+G"] }, "win32");
    const keys = pageKeys(custom);
    expect(keys.some((d) => d.c === 1 && d.k === "G" && !d.s)).toBe(true);
    expect(keys.some((d) => d.c === 1 && d.k === "F" && !d.s && !d.a)).toBe(false);
    const mac = pageKeys(defaultsOnly("darwin"));
    expect(mac.some((d) => d.m === 1 && d.k === "W" && !d.c)).toBe(true);
  });

  it("a forwarded press replays as the key event the app's own matcher understands", () => {
    const init = keyEventInit({ id: 1, k: "Tab", c: "Tab", m: "c" });
    expect(init).toMatchObject({ key: "Tab", code: "Tab", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, modifierAltGraph: false, bubbles: true });
    const e = { ...init, key: "Tab", code: "Tab", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false } as KeyboardEvent;
    expect(matchEvent(defaultsOnly("win32"), e, ["tabs"])).toEqual({ id: "tab.previousRecent" });
    const w = keyEventInit({ id: 1, k: "w", c: "KeyW", m: "c" });
    expect(matchEvent(defaultsOnly("win32"), { key: "w", code: "KeyW", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }, ["tabs"])).toEqual({ id: "tab.close" });
    expect(w.ctrlKey).toBe(true);
    expect(keyEventInit({ id: 1, k: "}", c: "Digit0", m: "cag" }).modifierAltGraph).toBe(true);
  });

  it("T-240 BROW-035: Mod+C is forwarded only for a grab (marked n), follows a rebinding, and Mac uses the command key", () => {
    expect(pageKeys(defaultsOnly("darwin")).some((d) => d.m === 1 && d.k === "C" && d.n === 1 && !d.c)).toBe(true);
    const moved = pageKeys(resolve({ "browser.grabElement": ["Mod+Shift+G"] }, "win32"));
    expect(moved.some((d) => d.k === "C" && d.c && !d.s)).toBe(false);
    expect(moved.some((d) => d.k === "G" && d.c === 1 && d.s === 1 && !d.n)).toBe(true); // not an editing chord: no selection check
    expect(pageKeys(resolve({ "browser.grabElement": [] }, "win32")).some((d) => d.k === "C")).toBe(false);
  });

  it("T-240 BROW-035: a forwarded press starts a grab only when it is the chord bound to Grab Page Element", () => {
    const win = defaultsOnly("win32");
    expect(startsGrab(win, { id: 1, k: "c", c: "KeyC", m: "c" })).toBe(true);
    expect(startsGrab(win, { id: 1, k: "c", c: "KeyC", m: "cs" })).toBe(false);
    expect(startsGrab(win, { id: 1, k: "w", c: "KeyW", m: "c" })).toBe(false);
    expect(startsGrab(defaultsOnly("darwin"), { id: 1, k: "c", c: "KeyC", m: "m" })).toBe(true);
    expect(startsGrab(resolve({ "browser.grabElement": ["Mod+Shift+G"] }, "win32"), { id: 1, k: "c", c: "KeyC", m: "c" })).toBe(false);
  });
});
