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
    expect(unsupported('hi <a href="https://x.y/a_b_c">there</a>\n')).toBe("it has HTML"); // row 94: only a tag the rich view would rewrite
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

// EDIT-019 (row 94): hard-wrapped prose is one flowing paragraph in the rich view.
describe("hard-wrapped prose (EDIT-019)", () => {
  it("flows adjacent lines into one paragraph, keeping blocks and hard breaks apart", () => {
    expect(roundTrip("one wrapped\nline two\nline three\n\nnext para\n")).toBe("one wrapped line two line three\n\nnext para");
    expect(roundTrip("a  \nb\n")).toBe("a  \nb"); // a trailing-space hard break stays a break
    expect(roundTrip("- item one\n  continued\n- two\n")).toBe("- item one continued\n- two");
    expect(roundTrip("# Head\ntext\nmore\n")).toBe("# Head\n\ntext more");
  });

  it("still keeps the wrapped lines of an untouched paragraph on disk", async () => {
    const { richChange } = await import("./frontMatter");
    const body = "first wrapped\nparagraph here\n\nsecond one\nwrapped too\n";
    const prev = roundTrip(body)!;
    const edited = roundTrip(body.replace("second", "2nd"))!;
    const c = richChange(body, edited, prev)!;
    expect(body.slice(0, c.from) + c.insert + body.slice(c.to)).toBe("first wrapped\nparagraph here\n\n2nd one\nwrapped too\n");
  });

  it("flows inside a collapsible section too", () => {
    expect(roundTrip("<details>\n<summary>S</summary>\n\nbody one\nbody two\n\n</details>")).toContain("body one body two");
  });
});

// EDIT-019 (row 94): raw HTML blocks and inline HTML no longer send the note to source view.
describe("raw and inline HTML in the rich view (EDIT-019)", () => {
  const block = '<div align="center">\n  <img src="a.png" width="100">\n</div>\n\nafter text\n';
  it("keeps a note with inline HTML, an HTML block, <br> and <kbd>", () => {
    expect(unsupported("Press <kbd>Ctrl</kbd>+<kbd>C</kbd> to copy<br>then x<sup>2</sup> and <br/> end\n")).toBeNull();
    expect(unsupported(block)).toBeNull();
    expect(unsupported("<table>\n<tr><td>a</td></tr>\n</table>\n")).toBeNull();
  });
  it("leaves HTML as typed when a neighbouring paragraph is edited", async () => {
    const { richChange } = await import("./frontMatter");
    const note = block + "\nPress <kbd>Ctrl</kbd> twice\n";
    const prev = roundTrip(note)!;
    const c = richChange(note, roundTrip(note.replace("twice", "once"))!, prev)!;
    expect(note.slice(0, c.from) + c.insert + note.slice(c.to)).toBe(note.replace("twice", "once"));
  });
  it("still refuses HTML whose tag the rich view would rewrite", () => {
    expect(unsupported('<a href="https://x.y/a_b_c">q</a>\n')).toBe("it has HTML");
  });
});
