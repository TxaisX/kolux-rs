import { beforeEach, describe, expect, it } from "vitest";
import { paletteRows } from "../projects/WorktreePalette";
import { bareAddress, dropPage, livePage, livePages, pageOf, pageRows, popClosed, pushClosed, rememberClosed, takeClosed } from "./pages";

beforeEach(() => {
  for (const [id] of livePages()) dropPage(id);
  while (takeClosed()) {
    /* empty the ring */
  }
});

describe("BROW-019 close and reopen browser tabs", () => {
  it("a real close of a page with an address is remembered, newest first; a blank or unknown page is not", () => {
    livePage(1, { url: "https://docs.rs/", title: "Docs.rs", cwd: "G:\\a" });
    livePage(2, { url: "about:blank" });
    expect(rememberClosed(1)).toBe(true);
    expect(rememberClosed(2)).toBe(false); // nothing to come back to
    expect(rememberClosed(9)).toBe(false); // unknown page id: refused, not reported as closed
    livePage(3, { url: "https://example.com/x", title: "", cwd: null });
    expect(rememberClosed(3)).toBe(true);
    expect(takeClosed()).toEqual({ url: "https://example.com/x", title: "", cwd: null });
    expect(takeClosed()).toEqual({ url: "https://docs.rs/", title: "Docs.rs", cwd: "G:\\a" });
    expect(takeClosed()).toBeNull();
  });

  it("the ring is bounded and pops newest first", () => {
    let ring = pushClosed([], { url: "https://a/", title: "a", cwd: null });
    for (let i = 0; i < 12; i++) ring = pushClosed(ring, { url: `https://b${i}/`, title: "", cwd: null });
    expect(ring).toHaveLength(10);
    const [top, rest] = popClosed(ring);
    expect(top?.url).toBe("https://b11/");
    expect(rest).toHaveLength(9);
    expect(popClosed([])).toEqual([null, []]);
  });
});

describe("BROW-022 the jump palette finds open browser pages", () => {
  it("rows carry the title and the address minus its scheme, the current worktree first, in a stable order", () => {
    livePage(5, { url: "https://doc.rust-lang.org/book/", title: "The Rust Book", cwd: "G:\\dev\\rust" });
    livePage(2, { url: "https://docs.python.org/3/", title: "Python docs", cwd: "G:\\dev\\py" });
    livePage(7, { url: "https://example.com/", title: "", cwd: "G:\\dev\\py" });
    const rows = pageRows(livePages(), "g:/dev/py", () => true, () => {});
    expect(rows.map((r) => r.label)).toEqual(["Python docs", "example.com", "The Rust Book"]);
    expect(rows[2]).toMatchObject({ section: "Browser pages", hint: "doc.rust-lang.org/book/", dir: "G:\\dev\\rust" });
    expect(bareAddress("https://example.com/")).toBe("example.com");
    expect(bareAddress("http://localhost:5173/app?x=1")).toBe("localhost:5173/app?x=1");
    expect(bareAddress("about:blank")).toBe("");
  });

  it("a query of several words must match every word across title and site", () => {
    livePage(1, { url: "https://doc.rust-lang.org/std/", title: "Docs", cwd: "G:\\a" });
    livePage(2, { url: "https://docs.python.org/3/", title: "Docs", cwd: "G:\\b" });
    const rows = pageRows(livePages(), "G:\\a", () => true, () => {});
    const hits = paletteRows(rows, "docs rust");
    expect(hits.map((r) => r.hint)).toEqual(["doc.rust-lang.org/std/"]);
    expect(paletteRows(rows, "docs")).toHaveLength(2);
    expect(paletteRows(rows, "")).toHaveLength(2);
  });

  it("a page closed while the palette listed it is reported as gone and nothing else opens", () => {
    livePage(4, { url: "https://example.com/", title: "Example", cwd: null });
    const went: number[] = [];
    let gone = 0;
    const rows = pageRows(livePages(), null, (id) => (went.push(id), true), () => gone++);
    dropPage(4);
    rows[0].run();
    expect(went).toEqual([]);
    expect(gone).toBe(1);
    // still open but the window no longer has the pane: gone as well
    livePage(6, { url: "https://example.com/b", title: "B", cwd: null });
    pageRows(livePages(), null, () => false, () => gone++)[0].run();
    expect(gone).toBe(2);
    expect(pageOf(6)?.title).toBe("B");
  });
});
