import { describe, expect, it } from "vitest";
import { codeSpans, textSegments, type Kind } from "./richCodeColour";

// After-list row 494: colours in the rich view's code blocks.
const words = (code: string, lang: string | null, kind: Kind) => codeSpans(code, lang).filter((s) => s.kind === kind).map((s) => code.slice(s.start, s.end));

describe("code colour spans", () => {
  it("finds keywords, strings, numbers and comments in TypeScript, through its short spelling", () => {
    const code = "const a = 'x' + 42; // note";
    expect(words(code, "ts", "keyword")).toEqual(["const"]);
    expect(words(code, "ts", "string")).toEqual(["'x'"]);
    expect(words(code, "ts", "number")).toEqual(["42"]);
    expect(words(code, "ts", "comment")).toEqual(["// note"]);
  });

  it("colours Rust, JSON and a shell comment", () => {
    expect(words("fn main() {}", "rust", "keyword")).toEqual(["fn"]);
    expect(words('{"k": true}', "json", "keyword").concat(words('{"k": true}', "json", "number"))).not.toEqual([]);
    expect(words("echo hi # c", "bash", "comment")).toEqual(["# c"]);
  });

  it("colours added and removed lines of a diff", () => {
    const code = "-old\n+new";
    expect(words(code, "diff", "del")).toEqual(["-old"]);
    expect(words(code, "diff", "add")).toEqual(["+new"]);
  });

  it("leaves an unknown, absent or plain-text language uncoloured", () => {
    for (const l of ["brainfuck", "", null, undefined, "text", "mermaid"]) expect(codeSpans("const a = 1;", l)).toEqual([]);
  });

  it("keeps offsets exact when the code has characters HTML would escape", () => {
    const code = `<a href="x">a & b</a> '`;
    const spans = codeSpans(code, "html");
    expect(spans.length).toBeGreaterThan(0);
    for (const s of spans) {
      expect(s.start).toBeGreaterThanOrEqual(0);
      expect(s.end).toBeLessThanOrEqual(code.length);
      expect(s.start).toBeLessThan(s.end);
    }
    expect(words(code, "html", "string")).toEqual(['"x"']);
  });

  it("never returns markup: a script tag in the code is only ever text offsets", () => {
    const code = "<script>alert(1)</script>";
    expect(JSON.stringify(codeSpans(code, "xml"))).not.toContain("<");
  });

  it("paints nothing for a block past the size cap", () => {
    expect(codeSpans("const a = 1;\n".repeat(5000), "ts")).toEqual([]);
  });
});

describe("text segments of a code element", () => {
  const text = (data: string) => ({ nodeType: 3, nodeName: "#text", data, childNodes: [] });
  const br = () => ({ nodeType: 1, nodeName: "BR", childNodes: [] });
  const el = (...childNodes: unknown[]) => ({ nodeType: 1, nodeName: "SPAN", childNodes });

  it("reads a line break as one newline and places offsets inside the right text node", () => {
    const a = text("ab");
    const b = text("cd");
    const root = el(a, br(), el(b));
    const m = textSegments(root as unknown as Node);
    expect(m.text).toBe("ab\ncd");
    expect(m.point(1, "start")).toEqual({ node: a, offset: 1 });
    expect(m.point(2, "end")).toEqual({ node: a, offset: 2 });
    expect(m.point(3, "start")).toEqual({ node: b, offset: 0 });
    expect(m.point(5, "end")).toEqual({ node: b, offset: 2 });
  });

  it("moves a start that sits on a line break to the next text, and has no point past the end", () => {
    const a = text("ab");
    const b = text("cd");
    const m = textSegments(el(a, br(), b) as unknown as Node);
    expect(m.point(2, "start")).toEqual({ node: b, offset: 0 });
    expect(m.point(6, "start")).toBeNull();
  });
});
