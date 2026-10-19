import { describe, expect, it } from "vitest";
import { foldKey, hasChildren, headingIndex, outline, visibleEntries, type Entry } from "./toc";

const NOTE = ["# Plan", "intro", "## **Bold** step", "### Detail with `code` and [a link](x.md)", "```", "# not a heading", "```", "## _Second_", "> ## Quoted", "# Last"].join("\n");

describe("EDIT-016 contents of a note", () => {
  it("lists the headings in order, with plain words and no markdown marks", () => {
    expect(outline(NOTE)).toEqual([
      { level: 1, text: "Plan" },
      { level: 2, text: "Bold step" },
      { level: 3, text: "Detail with code and a link" },
      { level: 2, text: "Second" },
      { level: 2, text: "Quoted" },
      { level: 1, text: "Last" },
    ]);
  });

  it("is empty for a note without headings, so no panel is offered", () => {
    expect(outline("just text\n\n- a list\n\n```\n# code\n```\n")).toEqual([]);
  });

  it("folding a heading hides the deeper ones under it, up to the next one at its level", () => {
    const list = outline(NOTE);
    expect(hasChildren(list, 0)).toBe(true);
    expect(hasChildren(list, 2)).toBe(false);
    expect(visibleEntries(list, new Set())).toEqual([0, 1, 2, 3, 4, 5]);
    expect(visibleEntries(list, new Set([foldKey(list[1])]))).toEqual([0, 1, 3, 4, 5]);
    expect(visibleEntries(list, new Set([foldKey(list[0])]))).toEqual([0, 5]);
    // A remembered fold on a heading that no longer has anything under it hides nothing.
    expect(visibleEntries(list, new Set([foldKey(list[5])]))).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

// FIX-5 (council P2 P8): an entry jumps to the heading with its own words, not to the heading at its
// position in the list, so a heading the rich view does not draw as a heading shifts nothing.
describe("FIX-5 jumping to the heading an entry names", () => {
  it("matches by level and words, counting repeats in order", () => {
    const list: Entry[] = [
      { level: 1, text: "Plan" },
      { level: 2, text: "Quoted" }, // inside a quote: the rich view draws it as plain text
      { level: 2, text: "Notes" },
      { level: 1, text: "Plan" },
      { level: 2, text: "Notes" },
    ];
    const drawn: Entry[] = [
      { level: 1, text: "Plan" },
      { level: 2, text: "Notes" },
      { level: 1, text: "Plan" },
      { level: 2, text: "Notes" },
    ];
    expect(headingIndex(list, 0, drawn)).toBe(0);
    expect(headingIndex(list, 2, drawn)).toBe(1); // by position it would have been the quote's slot
    expect(headingIndex(list, 3, drawn)).toBe(2);
    expect(headingIndex(list, 4, drawn)).toBe(3);
    expect(headingIndex(list, 1, drawn)).toBe(-1); // not drawn as a heading: no jump, never a wrong one
  });

  it("ignores differences in spacing", () => {
    expect(headingIndex([{ level: 2, text: "A b" }], 0, [{ level: 2, text: "A  b " }])).toBe(0);
  });
});
