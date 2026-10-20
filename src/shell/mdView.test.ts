import { describe, expect, it } from "vitest";
import { splitFront } from "../editor/frontMatter";
import { draggedWidth, frontBlock, frontControl, nudgedWidth, tocVar } from "./mdView";
import { DEFAULT_PREFS, mdPrefs, setMdPrefs, TOC_WIDTH } from "./mdPrefs";

const mem = (): Pick<Storage, "getItem" | "setItem"> => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

describe("VIEW-113 front matter control", () => {
  const note = "---\ntitle: Plan\ntags: [a]\n---\n# Heading\n";
  const front = splitFront(note).front;
  it("draws the front matter above the note, without its closing line end", () => {
    expect(frontBlock(front, false)).toBe("---\ntitle: Plan\ntags: [a]\n---");
  });
  it("draws nothing when hidden or when the note has none", () => {
    expect(frontBlock(front, true)).toBeNull();
    expect(frontBlock(splitFront("# Just text\n").front, false)).toBeNull();
  });
  it("the control appears only for a note with front matter and names what it would do", () => {
    expect(frontControl("", false)).toBeNull();
    expect(frontControl(front, false)).toEqual({ label: "Hide front matter", pressed: true });
    expect(frontControl(front, true)).toEqual({ label: "Show front matter", pressed: false });
  });
  it("hide front matter, reopen: still hidden, for that file only", () => {
    const s = mem();
    expect(mdPrefs("C:/n/a.md", s).hideFront).toBe(false);
    setMdPrefs("C:/n/a.md", { hideFront: true }, s);
    expect(mdPrefs("C:\\n\\A.md", s).hideFront).toBe(true);
    expect(mdPrefs("C:/n/b.md", s).hideFront).toBe(DEFAULT_PREFS.hideFront);
  });
});

describe("VIEW-113 contents panel width", () => {
  it("dragging the left edge left widens the panel, right narrows it", () => {
    expect(draggedWidth(230, 800, 780)).toBe(250);
    expect(draggedWidth(230, 800, 830)).toBe(200);
  });
  it("past the limits it stops at the limit", () => {
    expect(draggedWidth(230, 800, -5000)).toBe(TOC_WIDTH.max);
    expect(draggedWidth(230, 800, 9000)).toBe(TOC_WIDTH.min);
  });
  it("a pointer without a position leaves the width where it was", () => {
    expect(draggedWidth(300, Number.NaN, 10)).toBe(300);
  });
  it("the chosen width is remembered for that file and clamped when read back", () => {
    const s = mem();
    setMdPrefs("C:/n/a.md", { tocWidth: draggedWidth(230, 800, 700) }, s);
    expect(mdPrefs("C:/n/a.md", s).tocWidth).toBe(330);
    setMdPrefs("C:/n/a.md", { tocWidth: 99999 }, s);
    expect(mdPrefs("C:/n/a.md", s).tocWidth).toBe(TOC_WIDTH.max);
  });
  it("feeds the pane a CSS variable inside the limits", () => {
    expect(tocVar(300)).toEqual({ "--toc-w": "300px" });
    expect(tocVar(5)).toEqual({ "--toc-w": `${TOC_WIDTH.min}px` });
  });
  it("arrow keys on the handle move it by 16px and Home/End jump to the limits", () => {
    expect(nudgedWidth(230, "ArrowLeft", TOC_WIDTH.min, TOC_WIDTH.max)).toBe(246);
    expect(nudgedWidth(230, "ArrowRight", TOC_WIDTH.min, TOC_WIDTH.max)).toBe(214);
    expect(nudgedWidth(415, "ArrowLeft", TOC_WIDTH.min, TOC_WIDTH.max)).toBe(TOC_WIDTH.max);
    expect(nudgedWidth(230, "Home", TOC_WIDTH.min, TOC_WIDTH.max)).toBe(TOC_WIDTH.min);
    expect(nudgedWidth(230, "End", TOC_WIDTH.min, TOC_WIDTH.max)).toBe(TOC_WIDTH.max);
    expect(nudgedWidth(230, "a", TOC_WIDTH.min, TOC_WIDTH.max)).toBeNull();
  });
});
