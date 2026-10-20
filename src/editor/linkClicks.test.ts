import { describe, expect, it, vi } from "vitest";
import { followClick, headingEl } from "./linkClicks";

// EDIT-014 (T-234-b): Mod+click follows a note link; a plain click does not. No DOM here: the page
// and its links are small stand-ins with the few members the code reads.
const NOTE = String.raw`C:\w\docs\a.md`;
const ROOT = String.raw`C:\w`;
const heads = ["Intro", "Intro", "Other"].map((t) => ({ textContent: t, scrollIntoView: vi.fn() }));
const page = { querySelectorAll: () => heads, contains: () => true } as unknown as HTMLElement;
const click = (href: string, init: Partial<MouseEvent> = {}) => {
  const e = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, target: { closest: () => ({ getAttribute: () => href }) }, ...init };
  return e as unknown as MouseEvent & { defaultPrevented: boolean };
};

describe("headings by anchor", () => {
  it("the repeated heading is numbered like GitHub's slugs", () => {
    expect(headingEl(page, "intro")).toBe(heads[0]);
    expect(headingEl(page, "intro-1")).toBe(heads[1]);
    expect(headingEl(page, "other")).toBe(heads[2]);
    expect(headingEl(page, "nope")).toBeNull();
  });
});

describe("following links in a note", () => {
  it("a plain click follows nothing", () => {
    const on = vi.fn();
    const e = click("https://example.com");
    expect(followClick(e, page, NOTE, ROOT, on)).toBe(false);
    expect(e.defaultPrevented).toBe(false);
    expect(on).not.toHaveBeenCalled();
  });

  it("Mod+click hands a web link over, Shift held says system browser", () => {
    const on = vi.fn();
    expect(followClick(click("https://example.com", { ctrlKey: true }), page, NOTE, ROOT, on)).toBe(true);
    followClick(click("https://example.com", { metaKey: true, shiftKey: true }), page, NOTE, ROOT, on);
    expect(on.mock.calls).toEqual([[{ kind: "web", url: "https://example.com" }, false], [{ kind: "web", url: "https://example.com" }, true]]);
  });

  it("a relative note link arrives resolved, with its line, and the click does not navigate", () => {
    const on = vi.fn();
    const e = click("b.md#L3", { ctrlKey: true });
    followClick(e, page, NOTE, ROOT, on);
    expect(e.defaultPrevented).toBe(true);
    expect(on).toHaveBeenCalledWith({ kind: "file", path: String.raw`C:\w\docs\b.md`, line: 3, how: "editor" }, false);
  });

  it("an anchor into this note scrolls to its heading; other schemes do nothing", () => {
    const on = vi.fn();
    followClick(click("#intro-1", { ctrlKey: true }), page, NOTE, null, on);
    followClick(click("mailto:a@b.c", { ctrlKey: true }), page, NOTE, null, on);
    expect(heads[1].scrollIntoView).toHaveBeenCalledTimes(1);
    expect(heads[0].scrollIntoView).not.toHaveBeenCalled();
    expect(on).not.toHaveBeenCalled();
  });

  it("not a left click, or not on a link, is left alone", () => {
    const on = vi.fn();
    expect(followClick(click("b.md", { ctrlKey: true, button: 2 }), page, NOTE, ROOT, on)).toBe(false);
    const off = { ...click("b.md", { ctrlKey: true }), target: { closest: () => null } } as unknown as MouseEvent;
    expect(followClick(off, page, NOTE, ROOT, on)).toBe(false);
  });
});
