import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, safeHref } from "./markdown";

describe("GIT-050 rendered descriptions", () => {
  it("turns markdown into blocks", () => {
    const blocks = parseMarkdown("# Title\n\nSome **bold** and `code`\nsecond line\n\n- one\n- two\n\n1. a\n\n> quoted\n\n```ts\nlet x = 1;\n```\n");
    expect(blocks.map((b) => b.t)).toEqual(["heading", "para", "list", "list", "quote", "code"]);
    expect(blocks[0]).toMatchObject({ level: 1 });
    expect(blocks[2]).toMatchObject({ ordered: false });
    expect((blocks[2] as { items: unknown[] }).items).toHaveLength(2);
    expect(blocks[3]).toMatchObject({ ordered: true });
    expect(blocks[5]).toEqual({ t: "code", text: "let x = 1;" });
    expect(parseMarkdown("")).toEqual([]);
  });
  it("only ever links http(s) addresses, and never builds HTML", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("https://github.com/a/b")).toBe("https://github.com/a/b");
    const spans = parseInline("[ok](https://x.example/a) [bad](javascript:alert(1)) <img src=x onerror=alert(1)> see https://y.example/z");
    expect(spans.filter((s) => s.t === "link").map((s) => (s as { href: string }).href)).toEqual(["https://x.example/a", "https://y.example/z"]);
    expect(spans.some((s) => s.t === "text" && s.text.includes("<img src=x onerror=alert(1)>"))).toBe(true);
    expect(spans.some((s) => s.t === "text" && s.text.includes("[bad](javascript:alert(1)"))).toBe(true);
  });
  it("leaves HTML comments out, as a pull request template's hints, but keeps them in code", () => {
    const blocks = parseMarkdown("Intro\n\n<!-- Describe the change\nover two lines -->\n\nAfter <!-- inline --> text <!-- unclosed\nstill hidden\n\n```\n<!-- kept -->\n```\n");
    const words = blocks.map((b) => (b.t === "code" ? b.text : b.t === "list" ? "" : b.spans.map((x) => x.text).join("")));
    expect(words).toEqual(["Intro", "After  text", "<!-- kept -->"]);
  });
  it("reads bold, italic and inline code", () => {
    expect(parseInline("a **b** *c* `d`").map((s) => s.t)).toEqual(["text", "bold", "text", "italic", "text", "code"]);
  });
});
