// TERM-092 / TERM-093: links and file paths found in terminal text; wrapped rows joined; paths resolved.
import { describe, expect, it } from "vitest";
import { clickTarget, findLinks, fromFileUrl, hintFor, rangeOf, resolvePath, spanOf, type Row } from "./links";

const targets = (s: string) => findLinks(s).map((f) => `${f.kind}:${f.target}${f.line !== undefined ? `@${f.line}` : ""}${f.column !== undefined ? `,${f.column}` : ""}`);

describe("TERM-092 clickable web links", () => {
  it("finds http(s) links and leaves the sentence's trailing punctuation out", () => {
    expect(targets("see https://example.com/a/b?x=1, then (https://en.wikipedia.org/wiki/Foo_(bar)).")).toEqual(["url:https://example.com/a/b?x=1", "url:https://en.wikipedia.org/wiki/Foo_(bar)"]);
    expect(findLinks("open http://localhost:1424/x.").map((f) => f.target)).toEqual(["http://localhost:1424/x"]);
    expect(findLinks("x")).toEqual([]);
    const [f] = findLinks("go https://a.b/c now");
    expect([f.start, f.end]).toEqual([3, 16]);
  });

  it("a link wrapped over rows is read as one: the joined span, then cell ranges back", () => {
    const rows: Row[] = [
      { text: "unrelated", isWrapped: false },
      { text: "see https://example.com/", isWrapped: false },
      { text: "very/long/path.html", isWrapped: true },
      { text: "next", isWrapped: false },
    ];
    const span = spanOf((y) => rows[y], 2, 24);
    expect(span).toEqual({ first: 1, text: "see https://example.com/very/long/path.html" });
    const [f] = findLinks(span.text);
    expect(f.target).toBe("https://example.com/very/long/path.html");
    expect(rangeOf(f.start, f.end, span.first, 24)).toEqual({ start: { x: 5, y: 2 }, end: { x: 19, y: 3 } });
    expect(spanOf((y) => rows[y], 1, 24).first).toBe(1); // asked for the first row: the same span
    expect(spanOf((y) => rows[y], 3, 24)).toEqual({ first: 3, text: "next" });
  });

  it("the click goes to the system browser unless Open-in-Kolux is on; Shift always means the browser; no modifier, no click", () => {
    const url = findLinks("https://a.b")[0];
    const mods = (m: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }>) => ({ ctrlKey: false, metaKey: false, shiftKey: false, ...m });
    expect(clickTarget(url, mods({}), false, false)).toBeNull();
    expect(clickTarget(url, mods({ ctrlKey: true }), false, false)).toBe("system");
    expect(clickTarget(url, mods({ ctrlKey: true }), false, true)).toBe("kolux");
    expect(clickTarget(url, mods({ ctrlKey: true, shiftKey: true }), false, true)).toBe("system");
    expect(clickTarget(url, mods({ metaKey: true }), true, false)).toBe("system"); // macOS: Cmd
    expect(clickTarget(url, mods({ ctrlKey: true }), true, false)).toBeNull();
    expect(hintFor(url, false, "browser")).toBe("Ctrl+click to open https://a.b in your browser");
    expect(hintFor(url, true, "kolux")).toBe("Cmd+click to open https://a.b in Kolux");
  });

  it("Alt with the modifier inverts the destination when a Kolux viewer exists; Shift beats Alt; no viewer, always the browser", () => {
    const url = findLinks("https://a.b")[0];
    const e = (m: Partial<{ shiftKey: boolean; altKey: boolean }>) => ({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, ...m });
    expect(clickTarget(url, e({ altKey: true }), false, false, true)).toBe("kolux"); // setting off, Alt: Kolux
    expect(clickTarget(url, e({ altKey: true }), false, true, true)).toBe("system"); // setting on, Alt: browser
    expect(clickTarget(url, e({ altKey: true, shiftKey: true }), false, false, true)).toBe("system");
    expect(clickTarget(url, e({}), false, true, false)).toBe("system"); // setting on but nothing wired
    expect(clickTarget(url, e({ altKey: true }), false, false, false)).toBe("system");
  });

  it("non-Latin letters in a URL path stay part of the link", () => {
    expect(targets("docs: https://zh.wikipedia.org/wiki/终端模拟器 and https://ja.wikipedia.org/wiki/端末エミュレータ.")).toEqual(["url:https://zh.wikipedia.org/wiki/终端模拟器", "url:https://ja.wikipedia.org/wiki/端末エミュレータ"]);
  });
});

describe("TERM-093 clickable file paths", () => {
  it("finds Windows, UNC, POSIX, relative and file:// paths with an optional :line(:col) or (line,col)", () => {
    expect(targets("error in C:\\src\\app\\main.rs:12:5 and D:/x/y.txt")).toEqual(["file:C:\\src\\app\\main.rs@12,5", "file:D:/x/y.txt"]);
    expect(targets("see \\\\server\\share\\doc.md")).toEqual(["file:\\\\server\\share\\doc.md"]);
    expect(targets("at /usr/lib/x.so and ./src/a.ts:3 and src/b/c.tsx(7,2)")).toEqual(["file:/usr/lib/x.so", "file:./src/a.ts@3", "file:src/b/c.tsx@7,2"]);
    expect(targets("file:///C:/a/b%20c.txt and file:///home/u/x")).toEqual(["file:C:/a/b c.txt", "file:/home/u/x"]);
    expect(targets("main.rs:12 but not node.js alone")).toEqual(["file:main.rs@12"]);
  });

  it("trailing punctuation is left out; numbers and bare words are not paths", () => {
    expect(targets("(C:\\a\\b.txt).")).toEqual(["file:C:\\a\\b.txt"]);
    expect(targets("open src/a.ts, then 'src/b.ts'.")).toEqual(["file:src/a.ts", "file:src/b.ts"]);
    expect(targets("16/10 and 3/4 at 12:30")).toEqual([]);
    expect(targets("PS G:\\Temp\\repo> ")).toEqual(["file:G:\\Temp\\repo"]);
  });

  it("a relative path resolves against the pane's folder; an absolute one is kept; no folder, no link", () => {
    expect(resolvePath("src/a.ts", "G:\\Dev\\proj")).toBe("G:\\Dev\\proj\\src\\a.ts");
    expect(resolvePath("./src/a.ts", "G:\\Dev\\proj\\")).toBe("G:\\Dev\\proj\\src\\a.ts");
    expect(resolvePath("../other/b.rs", "G:\\Dev\\proj")).toBe("G:\\Dev\\other\\b.rs");
    expect(resolvePath("src/a.ts", "/home/u/proj")).toBe("/home/u/proj/src/a.ts");
    expect(resolvePath("C:\\x\\y.txt", "G:\\Dev")).toBe("C:\\x\\y.txt");
    expect(resolvePath("\\\\srv\\share\\f", "G:\\Dev")).toBe("\\\\srv\\share\\f");
    expect(resolvePath("src/a.ts", null)).toBeNull();
    expect(fromFileUrl("file://server/share/x.txt")).toBe("\\\\server\\share\\x.txt");
    expect(hintFor(findLinks("src/a.ts:3")[0], false, "editor")).toBe("Ctrl+click to open src/a.ts at line 3 in the editor");
    expect(clickTarget(findLinks("src/a.ts")[0], { ctrlKey: true, metaKey: false, shiftKey: true }, false, true)).toBe("file");
  });
});
