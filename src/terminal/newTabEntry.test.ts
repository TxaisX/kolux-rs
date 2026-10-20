import { describe, expect, it } from "vitest";
import { entryRows, looksLikePath, moveHighlight, rememberEntry, runRow, splitPath, webAddress, type EntryContext } from "./newTabEntry";

const ctx = (over: Partial<EntryContext> = {}): EntryContext => ({ tabs: [], history: [], recents: [], fileExists: () => false, ...over });

describe("TERM-042 web addresses", () => {
  it("keeps http and https as typed", () => {
    expect(webAddress("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(webAddress("http://localhost:3000")).toBe("http://localhost:3000");
  });
  it("bare private IPv4 and dev hosts get http", () => {
    expect(webAddress("192.168.1.10:3000")).toBe("http://192.168.1.10:3000");
    expect(webAddress("10.0.0.5")).toBe("http://10.0.0.5");
    expect(webAddress("172.20.1.1/admin")).toBe("http://172.20.1.1/admin");
    expect(webAddress("localhost:5173/app")).toBe("http://localhost:5173/app");
    expect(webAddress("api.localhost")).toBe("http://api.localhost");
  });
  it("is not fooled by public hosts, bad ports, other schemes or words", () => {
    expect(webAddress("8.8.8.8")).toBeNull();
    expect(webAddress("172.32.0.1")).toBeNull();
    expect(webAddress("192.168.1.999")).toBeNull();
    expect(webAddress("localhost:99999")).toBeNull();
    expect(webAddress("file:///c:/x")).toBeNull();
    expect(webAddress("two words")).toBeNull();
    expect(webAddress("")).toBeNull();
  });
});

describe("TERM-042 paths and rows", () => {
  it("recognises local paths", () => {
    for (const p of ["C:\\Users\\a\\notes.md", "C:/x/y", "\\\\srv\\share\\a.txt", "/etc/hosts", "~/a.md", "./a", "../b", "src/app.ts"]) expect(looksLikePath(p), p).toBe(true);
    for (const p of ["hello", "notes.md", "https://a.com/b.html", ""]) expect(looksLikePath(p), p).toBe(false);
  });
  it("puts the file name before its folder", () => {
    expect(splitPath("C:\\Users\\a\\notes.md")).toEqual({ name: "notes.md", folder: "C:\\Users\\a" });
    expect(splitPath("/a/b/c.txt")).toEqual({ name: "c.txt", folder: "/a/b" });
    expect(splitPath("plain")).toEqual({ name: "plain", folder: "" });
  });
  it("offers to open 192.168.1.10:3000 in the browser", () => {
    const rows = entryRows("192.168.1.10:3000", ctx());
    expect(rows[0]).toMatchObject({ kind: "url", url: "http://192.168.1.10:3000" });
  });
  it("offers to open the path of an existing file, and not one that is missing", () => {
    const here = entryRows("C:\\w\\a.md", ctx({ fileExists: (p) => p === "C:\\w\\a.md" }));
    expect(here[0]).toMatchObject({ kind: "file", path: "C:\\w\\a.md", label: "a.md", detail: "C:\\w" });
    expect(entryRows("C:\\w\\gone.md", ctx())).toEqual([]);
  });
  it("searches open tabs and history, address first, no duplicate of the address", () => {
    const rows = entryRows("local", ctx({ tabs: [{ key: 3, name: "localhost app" }, { key: 4, name: "other" }], history: ["http://localhost:3000", "C:\\w\\local.txt", "https://x.dev"] }));
    expect(rows.map((r) => r.kind)).toEqual(["tab", "history", "history"]);
    const url = entryRows("localhost:3000", ctx({ history: ["http://localhost:3000", "http://localhost:3000/b"] }));
    expect(url.map((r) => r.kind)).toEqual(["url", "history"]);
  });
  it("with nothing typed, shows the recent entries by recency", () => {
    const rows = entryRows("  ", ctx({ recents: ["http://a.dev", "C:\\w\\b.md"] }));
    expect(rows.map((r) => r.kind)).toEqual(["recent", "recent"]);
    expect(rows[1]).toMatchObject({ label: "b.md", detail: "C:\\w" });
  });
});

describe("TERM-042 recents and keys", () => {
  it("remembers newest first without repeats, bounded", () => {
    expect(rememberEntry(["a", "b"], "b")).toEqual(["b", "a"]);
    expect(rememberEntry(["a"], "  ")).toEqual(["a"]);
    expect(rememberEntry(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
  it("arrow keys stop at the ends and Enter runs the highlighted row", () => {
    expect(moveHighlight(0, 3, -1)).toBe(0);
    expect(moveHighlight(2, 3, 1)).toBe(2);
    expect(moveHighlight(1, 3, 1)).toBe(2);
    expect(moveHighlight(0, 0, 1)).toBe(0);
    const rows = entryRows("localhost", ctx());
    expect(runRow(rows, 0)?.kind).toBe("url");
    expect(runRow(rows, 5)).toBeNull();
  });
});
