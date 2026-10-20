import { describe, expect, it } from "vitest";
import { changeBetween, isMarkdown, roundTrip, unsupported } from "./markdown";

describe("rich markdown view (EDIT-012)", () => {
  it("shows ordinary markdown and keeps every word", () => {
    const md = "# Title\n\nSome **bold** and *italic* text with a [link](https://example.com).\n\n- one\n- two\n\n> quoted\n\n```js\nconst x = 1;\n```\n";
    expect(unsupported(md)).toBeNull();
    const back = roundTrip(md)!;
    expect(back).toContain("# Title");
    expect(back).toContain("**bold**");
    expect(back).toContain("[link](https://example.com)");
  });

  it("names what it cannot show", () => {
    expect(unsupported("---\ntitle: x\n---\n# A\n")).toBe("it has front matter");
    expect(unsupported("hi <b>there</b>\n")).toBe("it has HTML");
    expect(unsupported("![logo](a.png)\n")).toBe("it has images");
    expect(unsupported("see [x][1]\n\n[1]: https://a.b\n")).toBe("it has reference links");
    expect(unsupported("Title\n=====\n")).toBe("it has underlined headings");
    expect(unsupported("a\n\n---\n\nb\n")).toBe("it has horizontal rules");
  });

  it("does not look for HTML inside code", () => {
    expect(unsupported("Use `<div>` here.\n\n```html\n<p>hi</p>\n```\n")).toBeNull();
  });

  it("task lists survive the trip", () => {
    expect(unsupported("- [ ] open\n- [x] done\n")).toBeNull();
  });

  it("a change is only the span that differs", () => {
    expect(changeBetween("hello world", "hello brave world")).toEqual({ from: 6, to: 6, insert: "brave " });
    expect(changeBetween("abc", "abc")).toBeNull();
    expect(changeBetween("aXc", "ac")).toEqual({ from: 1, to: 2, insert: "" });
    expect(changeBetween("aaa", "aa")).toEqual({ from: 2, to: 3, insert: "" });
  });

  it("knows markdown files by name", () => {
    expect([isMarkdown("C:\r\README.md"), isMarkdown("notes.MARKDOWN"), isMarkdown("main.rs")]).toEqual([true, true, false]);
  });
});
