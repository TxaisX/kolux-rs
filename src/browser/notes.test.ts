import { describe, expect, it } from "vitest";
import { CAP, cut, fence, fold, notesMarkdown, type Note } from "./notes";

const note = (over: Partial<Note> = {}): Note => ({
  url: "http://127.0.0.1:8745/probe.html",
  selector: "#buy",
  tag: "button",
  text: "Buy now",
  html: '<button id="buy">Buy now</button>',
  components: ["BuyButton", "Cart", "App"],
  sources: ["data-testid=buy"],
  styles: { color: "rgb(255, 255, 255)", "background-color": "rgb(79, 140, 255)" },
  intent: "change",
  comment: "make it green",
  at: "2026-10-13T10:00:00.000Z",
  ...over,
});

describe("BROW-037 page notes", () => {
  it("two notes become one Markdown block with selector, source hints, components, styles and the comment", () => {
    const md = notesMarkdown([note(), note({ selector: "h1", tag: "h1", intent: "bug", comment: "wraps on narrow screens", components: [], sources: [], html: "<h1>Probe</h1>" })]);
    expect(md.startsWith("Page notes (2) from http://127.0.0.1:8745/probe.html\n")).toBe(true);
    expect(md).toContain("1. **Change** — `#buy`");
    expect(md).toContain("   make it green");
    expect(md).toContain("   - source hints: data-testid=buy");
    expect(md).toContain("   - components: BuyButton < Cart < App");
    expect(md).toContain("   - styles: color: rgb(255, 255, 255); background-color: rgb(79, 140, 255)");
    expect(md).toContain("2. **Broken** — `h1`");
    expect(md).toContain("   wraps on narrow screens");
    expect(md.trim().split("\n\n").length).toBe(3); // header + two notes, one message
  });

  it("sends nothing for no notes and caps a page at twenty", () => {
    expect(notesMarkdown([])).toBe("");
    expect(CAP).toBe(20);
  });

  it("page text cannot break the Markdown: fences lengthen, breaks fold, cuts respect characters", () => {
    expect(fence("a ``` b")).toBe("````");
    expect(fence("plain")).toBe("```");
    expect(fold("one\n\ntwo\r\n  three")).toBe("one two three");
    expect(cut("héllo wörld", 5)).toBe("héllo…");
    const pair = "ab\u{1F600}cd"; // the emoji is two UTF-16 units
    expect(cut(pair, 3)).toBe("ab…");
    expect(cut(pair, 4)).toBe("ab\u{1F600}…");
    const md = notesMarkdown([note({ html: "<pre>```\nx</pre>", comment: "line one\nline two" })]);
    expect(md).toContain("   ````html\n   <pre>``` x</pre>\n   ````");
    expect(md).toContain("   line one line two");
  });
});
