// BROW-004: the address bar's drop-down of history suggestions.
import { describe, expect, it } from "vitest";
import { arrived, closed, first, fresh, type Hit, lines, move, pick, rows, shown, typed } from "./suggest";

const github: Hit = { kind: "page", url: "https://github.com/", title: "GitHub", label: "" };
const readme: Hit = { kind: "document", url: "http://127.0.0.1:4455/t/README.md", title: "README.md", label: "G:\\work\\README.md" };

describe("BROW-004 address bar suggestions", () => {
  it("plain text gets a search entry first, then the hits; an address gets a go-to entry", () => {
    const m = arrived(typed(fresh(), "git"), "git", [github]);
    expect(m.open).toBe(true);
    expect(m.items.map((s) => s.kind)).toEqual(["search", "page"]);
    expect(m.items[1].url).toBe("https://github.com/"); // github.com sits right under the search entry
    expect(first("github.com")).toMatchObject({ kind: "go", url: "https://github.com/" });
    expect(first("localhost:3000")).toMatchObject({ kind: "go", url: "http://localhost:3000/" });
    expect(first("   ")).toBeNull();
    expect(first("javascript:alert(1)")).toBeNull(); // refused by address.ts, so no row
    // a hit that is the go-to address itself is not listed twice
    expect(rows("github.com", [github]).length).toBe(1);
  });

  it("Escape closes the list and keeps the typed text; the list stays closed until the text changes", () => {
    let m = arrived(typed(fresh(), "git"), "git", [github]);
    m = closed(m);
    expect(m.open).toBe(false);
    expect(m.text).toBe("git");
    expect(typed(m, "git").open).toBe(false); // the same text (the page under it was replaced): still closed
    expect(typed(m, "gith").open).toBe(true);
    expect(typed(m, "").open).toBe(false); // nothing typed, nothing to list
  });

  it("answers for text the user has moved past are dropped", () => {
    let m = typed(fresh(), "gi");
    m = typed(m, "git");
    expect(arrived(m, "gi", [github]).items.map((s) => s.kind)).toEqual(["search"]);
    expect(arrived(m, "git", [github]).items.length).toBe(2);
  });

  it("the cursor walks the rows from the bar and back; Enter takes the row under it", () => {
    let m = arrived(typed(fresh(), "re"), "re", [github, readme]);
    expect(pick(m)).toBeNull();
    expect(shown(m, "re")).toBe("re");
    m = move(m, 1);
    expect(pick(m)?.kind).toBe("search");
    expect(shown(m, "re")).toBe("re"); // the search row keeps the words in the bar
    m = move(m, 1);
    expect(shown(m, "re")).toBe("https://github.com/");
    m = move(m, 1);
    expect(shown(m, "re")).toBe("G:\\work\\README.md");
    m = move(m, 1);
    expect(m.cursor).toBe(-1);
    m = move(m, -1);
    expect(pick(m)?.url).toBe(readme.url);
    expect(move(closed(m), 1).cursor).toBe(-1); // a closed list has no cursor
  });

  it("rows read as title over address, documents as file over path", () => {
    expect(lines({ kind: "page", url: "https://a.com/", title: "A", label: "" })).toEqual(["A", "https://a.com/"]);
    expect(lines({ kind: "page", url: "https://a.com/", title: "", label: "" })).toEqual(["https://a.com/", ""]);
    expect(lines(readme)).toEqual(["README.md", "G:\\work\\README.md"]);
    expect(lines(first("rust book")!)).toEqual(['Search for "rust book"', ""]);
  });
});
