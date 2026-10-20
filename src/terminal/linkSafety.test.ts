// ACCT-061: terminal links open only when safe; link detection that trips is contained to its row.
// ACCT-053: a wide character split across two output chunks crosses the border as its exact bytes.
import { describe, expect, it } from "vitest";
import { allowed, linkFor, safeLinks, type Found } from "./links";
import { decodeOutput } from "./codec";

const found = (kind: Found["kind"], target: string): Found => ({ start: 0, end: target.length, kind, target });

describe("ACCT-061 links open only when safe", () => {
  it("lets http, https and file links through and ignores every other scheme", () => {
    expect(allowed(found("url", "https://example.com/x"))).toBe(true);
    expect(allowed(found("url", "http://localhost:1424/"))).toBe(true);
    expect(allowed(found("url", "file:///C:/Users/me/a.txt"))).toBe(true);
    for (const bad of ["javascript:alert(1)", "data:text/html,hi", "ssh://host", "ftp://host/x", "vbscript:x", "ms-settings:display", "HTTPS:evil"]) {
      expect(allowed(found("url", bad))).toBe(false);
    }
  });

  it("refuses a file target with a control character, and takes an ordinary path", () => {
    expect(allowed(found("file", "C:\\Users\\me\\a.txt"))).toBe(true);
    expect(allowed(found("file", "src/a.ts"))).toBe(true);
    expect(allowed(found("file", "C:\\x\u0000.txt"))).toBe(false);
    expect(allowed(found("file", "a\u001bb"))).toBe(false);
    expect(allowed(found("file", ""))).toBe(false);
  });

  it("an OSC 8 link with another scheme is not a link at all", () => {
    expect(linkFor("javascript:alert(1)")).toBeNull();
    expect(linkFor("ssh://evil.com:22")).toBeNull();
    expect(linkFor("https://a.b/c")?.target).toBe("https://a.b/c");
  });

  it("a row scan that throws gives that row no links and does not throw out of the provider", () => {
    const notes: unknown[] = [];
    const out = safeLinks(() => {
      throw new RangeError("Maximum call stack size exceeded");
    }, (e) => notes.push(e));
    expect(out).toEqual([]);
    expect(notes).toHaveLength(1);
    expect(safeLinks(() => [1, 2])).toEqual([1, 2]);
  });
});

describe("ACCT-053 wide characters cross the border once", () => {
  it("a CJK character and an emoji cut between chunks reassemble to one character each", () => {
    const text = "中文 日本語 😀 end";
    const bytes = new TextEncoder().encode(text);
    // the Rust side chunks raw bytes wherever the PTY read stopped: cut inside 文 and inside the emoji
    const cuts = [4, 5, bytes.indexOf(0xf0) + 2];
    let at = 0;
    const chunks: string[] = [];
    for (const c of [...cuts, bytes.length]) {
      chunks.push(btoa(String.fromCharCode(...bytes.subarray(at, c))));
      at = c;
    }
    const joined = new Uint8Array(chunks.flatMap((c) => Array.from(decodeOutput(c))));
    expect(Array.from(joined)).toEqual(Array.from(bytes));
    // what xterm's own streaming decoder makes of the chunks, one at a time
    const dec = new TextDecoder();
    let seen = "";
    for (const c of chunks) seen += dec.decode(decodeOutput(c), { stream: true });
    expect(seen).toBe(text);
    expect([...seen].filter((ch) => ch === "文")).toHaveLength(1);
  });
});
