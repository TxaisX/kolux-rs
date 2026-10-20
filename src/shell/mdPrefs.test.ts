import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, TOC_WIDTH, clampTocWidth, mdPrefs, setMdPrefs } from "./mdPrefs";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("view-113 markdown view preferences", () => {
  it("a file with nothing saved reads the defaults", () => {
    expect(mdPrefs("C:/n/a.md", memory())).toEqual(DEFAULT_PREFS);
  });
  it("hide the front matter, reopen: still hidden; another file is not touched", () => {
    const s = memory();
    setMdPrefs("C:/n/a.md", { hideFront: true }, s);
    expect(mdPrefs("C:\\N\\a.md", s).hideFront).toBe(true);
    expect(mdPrefs("C:/n/b.md", s).hideFront).toBe(false);
  });
  it("one choice keeps the others", () => {
    const s = memory();
    setMdPrefs("a.md", { toc: true }, s);
    setMdPrefs("a.md", { hideFront: true }, s);
    expect(mdPrefs("a.md", s)).toEqual({ toc: true, tocWidth: TOC_WIDTH.start, hideFront: true });
  });
  it("the contents panel cannot pass its limits, and a broken width is the start width", () => {
    expect(clampTocWidth(9999)).toBe(TOC_WIDTH.max);
    expect(clampTocWidth(3)).toBe(TOC_WIDTH.min);
    expect(clampTocWidth("wide")).toBe(TOC_WIDTH.start);
    const s = memory();
    expect(setMdPrefs("a.md", { tocWidth: 5000 }, s).tocWidth).toBe(TOC_WIDTH.max);
  });
  it("broken saved text or a refusing store falls back to the defaults", () => {
    const bad = { getItem: () => "{not json", setItem: () => { throw new Error("full"); } };
    expect(mdPrefs("a.md", bad)).toEqual(DEFAULT_PREFS);
    expect(() => setMdPrefs("a.md", { toc: true }, bad)).not.toThrow();
    expect(mdPrefs("a.md", null)).toEqual(DEFAULT_PREFS);
  });
});
