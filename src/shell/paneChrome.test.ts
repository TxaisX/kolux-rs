import { describe, expect, it } from "vitest";
import { applyDensity, DENSITY_FIELD, HEAD_HEIGHT, installTabWheel, overflows, readDensity, wheelShift } from "./paneChrome";

describe("term-026 pane header density", () => {
  it("comfortable is the default and only a saved compact changes it", () => {
    expect(readDensity({})).toBe("comfortable");
    expect(readDensity(null)).toBe("comfortable");
    expect(readDensity({ [DENSITY_FIELD]: "tiny" })).toBe("comfortable");
    expect(readDensity({ [DENSITY_FIELD]: "compact" })).toBe("compact");
  });
  it("compact is shorter than comfortable, and switching back restores the attribute-free page", () => {
    expect(HEAD_HEIGHT.compact).toBeLessThan(HEAD_HEIGHT.comfortable);
    const attrs = new Map<string, string>();
    const root = { setAttribute: (k: string, v: string) => attrs.set(k, v), removeAttribute: (k: string) => attrs.delete(k), getAttribute: (k: string) => attrs.get(k) ?? null, hasAttribute: (k: string) => attrs.has(k) } as unknown as HTMLElement;
    expect(applyDensity({ [DENSITY_FIELD]: "compact" }, root)).toBe("compact");
    expect(root.getAttribute("data-pane-density")).toBe("compact");
    expect(applyDensity({ [DENSITY_FIELD]: "comfortable" }, root)).toBe("comfortable");
    expect(root.hasAttribute("data-pane-density")).toBe(false);
  });
});

describe("term-057 tab strip scrolling", () => {
  it("a vertical wheel turn moves the strip sideways, a sideways one is kept, lines are scaled", () => {
    expect(wheelShift({ deltaX: 0, deltaY: 40 })).toBe(40);
    expect(wheelShift({ deltaX: -25, deltaY: 3 })).toBe(-25);
    expect(wheelShift({ deltaX: 0, deltaY: 3, deltaMode: 1 })).toBe(48);
  });
  it("the bar shows only when the tabs overflow", () => {
    expect(overflows({ scrollWidth: 900, clientWidth: 400 })).toBe(true);
    expect(overflows({ scrollWidth: 400, clientWidth: 400 })).toBe(false);
  });
  it("the wheel over an overflowing strip scrolls it and is consumed; over a strip that fits it is left alone", () => {
    const strip = { scrollWidth: 900, clientWidth: 400, scrollLeft: 0 };
    const target = { closest: (sel: string) => (sel === ".tabs" ? strip : null) };
    let handler: ((e: unknown) => void) | undefined;
    const doc = { addEventListener: (_n: string, h: (e: unknown) => void) => (handler = h), removeEventListener: () => (handler = undefined) } as unknown as Document;
    const off = installTabWheel(doc);
    const wheel = (deltaY: number, ctrlKey = false) => ({ target, deltaX: 0, deltaY, ctrlKey, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
    const over = wheel(60);
    handler?.(over);
    expect(strip.scrollLeft).toBe(60);
    expect(over.defaultPrevented).toBe(true);
    const zoom = wheel(60, true);
    handler?.(zoom);
    expect([strip.scrollLeft, zoom.defaultPrevented]).toEqual([60, false]);
    strip.scrollWidth = 300;
    const fits = wheel(60);
    handler?.(fits);
    expect([strip.scrollLeft, fits.defaultPrevented]).toEqual([60, false]);
    handler?.({ target: { closest: () => null }, deltaX: 0, deltaY: 5, ctrlKey: false, preventDefault() {} });
    off();
    expect(handler).toBeUndefined();
  });
});
