import { describe, expect, it } from "vitest";
import { addNote, cut, fence, fold, MAX_NOTES, NOTE_MAX, notesMarkdown, readPicks, sameAddress, trim, type Note, type Pick } from "./annotate";

const pick = (over: Partial<Pick> = {}): Pick => ({ selector: "button#go", path: "body > main > button#go", tag: "button", text: "  Go\n  now ", ...over });

describe("BROW-037 the notes tray", () => {
  it("keeps a trimmed note per pick and refuses the twenty-first", () => {
    const one = addNote([], pick(), "  Too small\r\n\r\n\r\n\r\non phones  ")!;
    expect(one).toHaveLength(1);
    expect(one[0].text).toBe("Too small\n\non phones");
    expect(addNote([], pick(), "   ")).toEqual([]);
    const full: Note[] = Array.from({ length: MAX_NOTES }, (_, i) => ({ pick: pick({ selector: `#e${i}` }), text: `n${i}` }));
    expect(addNote(full, pick(), "one more")).toBeNull();
    expect(trim("x".repeat(NOTE_MAX + 5))).toHaveLength(NOTE_MAX);
  });

  it("cuts by code point and folds element text to one line", () => {
    expect(cut("ab😀cd", 3)).toBe("ab…");
    expect(cut("ab😀", 3)).toBe("ab😀");
    expect(fold("  Go\n  now ")).toBe("Go now");
  });

  it("empties on a new address but not on a hash change", () => {
    expect(sameAddress("https://a.test/x#top", "https://a.test/x#bottom")).toBe(true);
    expect(sameAddress("https://a.test/x", "https://a.test/y")).toBe(false);
  });

  it("fences a note with backticks in a longer fence", () => {
    expect(fence("plain")).toBe("```");
    expect(fence("has ``` inside")).toBe("````");
  });
});

describe("BROW-037 the message", () => {
  it("is nothing with no notes", () => {
    expect(notesMarkdown([], "T", "https://a.test/")).toBeNull();
  });

  it("names the page, then every element with its selector, component, source, hints and styles", () => {
    const notes: Note[] = [
      { pick: pick({ component: "Toolbar < App", source: "src/Toolbar.tsx:42", hints: { "data-testid": "go", class: "btn primary" }, styles: { color: "rgb(0, 0, 0)", "font-size": "12px" }, box: { x: 10, y: 20, width: 80, height: 24 } }), text: "Make this bigger" },
      { pick: pick({ selector: "p:nth-of-type(2)", path: undefined, text: undefined }), text: "Two lines\nwith `code`" },
    ];
    const md = notesMarkdown(notes, "Shop", "https://a.test/")!;
    expect(md).toContain("Page notes on Shop (https://a.test/), 2 elements:");
    expect(md).toContain("1. `button#go` (component Toolbar < App, at src/Toolbar.tsx:42)");
    expect(md).toContain('   text: "Go now"');
    expect(md).toContain('   attributes: data-testid="go"');
    expect(md).toContain("   class: btn primary");
    expect(md).toContain("   styles: color: rgb(0, 0, 0); font-size: 12px");
    expect(md).toContain("   box: 80×24 at 10,20");
    expect(md).toContain("   note: Make this bigger");
    expect(md).toContain("2. `p:nth-of-type(2)`\n   note:\n```\nTwo lines\nwith `code`\n```");
    expect(md.endsWith("\n")).toBe(true);
  });

  it("reads the picker's poll: picks, the Escape mark and whether the picker is still there", () => {
    expect(readPicks({ active: true, picks: [{ selector: "#a" }, { escape: true }, { bogus: 1 }] })).toEqual({ active: true, picks: [{ selector: "#a" }], escape: true });
    expect(readPicks({ active: false, picks: [] })).toEqual({ active: false, picks: [], escape: false });
    expect(readPicks(null).active).toBe(false);
  });
});
