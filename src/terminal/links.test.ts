// TERM-092 / TERM-093: links and file paths found in terminal text; wrapped rows joined; paths resolved.
import { describe, expect, it } from "vitest";
import { clickTarget, findLinks, fromFileUrl, hintFor, LINK_SCAN_CAP, linkFor, rangeOf, resolvePath, spanOf, type Row } from "./links";

const targets = (s: string) => findLinks(s).map((f) => `${f.kind}:${f.target}${f.line !== undefined ? `@${f.line}` : ""}${f.column !== undefined ? `,${f.column}` : ""}`);

describe("TERM-095 link detection never freezes on huge lines", () => {
  it("a 1 MB line on screen gets no link scan, and a hover over it costs a bounded walk", () => {
    const cols = 200;
    const text = "x".repeat(cols - 20) + " https://a.b/in-a-huge-line";
    const rowCount = Math.ceil((1 << 20) / cols); // one logical line of 1 MB, wrapped
    let reads = 0;
    const row = (y: number): Row | undefined => (y >= 0 && y < rowCount ? (reads++, { text, isWrapped: y > 0 }) : undefined);
    const t0 = performance.now();
    for (const y of [0, 1, 2500, rowCount - 1]) expect(findLinks(spanOf(row, y, cols).text)).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(reads).toBeLessThan(4 * 2 * (LINK_SCAN_CAP / cols + 2));
  });
  it("a span at the cap with no separator (base64, dots, hyphens) scans in linear time", () => {
    const b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const spans = ["x".repeat(LINK_SCAN_CAP), "a.".repeat(LINK_SCAN_CAP / 2), "a-".repeat(LINK_SCAN_CAP / 2), Array.from({ length: LINK_SCAN_CAP }, (_, i) => b64[i % 64]).join("")];
    for (const s of spans) {
      const t0 = performance.now();
      expect(findLinks(s)).toEqual([]);
      expect(performance.now() - t0, `${s.slice(0, 4)}...`).toBeLessThan(40);
    }
    // the run-start rule changes nothing about what is found
    expect(targets("x=src/a/b.ts:3 at ~/w/y.md (./c/d) k:lib/e.rs")).toEqual(["file:src/a/b.ts@3", "file:~/w/y.md", "file:./c/d", "file:lib/e.rs"]);
    expect(targets(" -foo.ts:3 --a-b.rs:4,1 x-y.md:2")).toEqual(["file:foo.ts@3", "file:a-b.rs@4", "file:x-y.md@2"]);
    const hyphens = "-".repeat(LINK_SCAN_CAP - 8) + "a.ts:1";
    const t0 = performance.now();
    expect(targets(hyphens)).toEqual(["file:a.ts@1"]);
    expect(performance.now() - t0).toBeLessThan(40);
  });
  it("a long line under the cap is still joined whole and scanned", () => {
    const cols = 80;
    const rows: Row[] = Array.from({ length: 12 }, (_, i) => ({ text: i === 11 ? "end https://a.b/x" : "y".repeat(cols), isWrapped: i > 0 }));
    const span = spanOf((y) => rows[y], 5, cols);
    expect(span.first).toBe(0);
    expect(findLinks(span.text).map((f) => f.target)).toEqual(["https://a.b/x"]);
    expect(spanOf((y) => rows[y], 5, cols, 10 * cols).text).toBe(""); // the same line past a smaller cap: no scan
  });
});

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

describe("TERM-093 a file link never hides a control character", () => {
  it("drops a file URL that decodes to a NUL or another control character", () => {
    expect(findLinks("file:///C:/a/run.bat%00.txt")).toEqual([]);
    expect(findLinks("see file:///G:/repo/tools/run.bat%00.txt now")).toEqual([]);
    expect(linkFor("file:///C:/x%00.txt")).toBeNull();
    expect(linkFor("file:///C:/x%0A.txt")).toBeNull();
    expect(linkFor("file:///C:/x%7F.txt")).toBeNull();
    expect(linkFor("file:///C:/x%20y.txt")?.target).toBe("C:/x y.txt");
  });

  it("a malformed % escape is no link and never throws", () => {
    expect(() => findLinks("file:///%E0%A4%A")).not.toThrow();
    expect(findLinks("file:///%E0%A4%A")).toEqual([]);
    expect(fromFileUrl("file:///C:/%ZZ")).toBeNull();
  });
});
