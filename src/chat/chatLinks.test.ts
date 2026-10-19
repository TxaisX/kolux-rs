// CHAT-025 (T-329): links in the agent's messages. Which parts of a reply are links, what each opens, which
// file paths may be opened (only those the agent printed recently), and which browser a click chooses.
import { describe, expect, it } from "vitest";
import { classify, openablePath, partsOf, printedPaths, webClick, type LinkTarget } from "./chatLinks";
import type { ChatItem } from "./model";

const links = (text: string) => partsOf(text).flatMap((p) => (p.link ? [p.link] : []));
const msg = (role: ChatItem["role"], text: string, kind = "text"): ChatItem => ({ id: `${role}-${text}`, role, kind, text });

describe("what a link target opens", () => {
  it("web, mail and file targets are links", () => {
    expect(classify("https://example.com/a?b=1")).toEqual({ kind: "web", url: "https://example.com/a?b=1" });
    expect(classify("mailto:a@b.co")).toEqual({ kind: "mail", href: "mailto:a@b.co" });
    expect(classify("src/app.ts:12:3")).toEqual({ kind: "file", path: "src/app.ts", line: 12, column: 3 });
    expect(classify("C:\\proj\\a.ts:7")).toEqual({ kind: "file", path: "C:\\proj\\a.ts", line: 7 });
    expect(classify("file:///C:/proj/a.ts")).toEqual({ kind: "file", path: "C:/proj/a.ts" });
  });
  it("page anchors, unknown kinds, malformed file links and empty links cannot be clicked", () => {
    for (const bad of ["", "   ", "#heading", "javascript:alert(1)", "data:text/html,x", "vscode://file/a", "ftp://host/x", "file:///a/%ZZ", "https://", "mailto:", "a\u0000b.txt"]) expect(classify(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe("a message cut into parts", () => {
  it("finds a file with line and column, a relative file, a web address and an email in running text", () => {
    const text = "See src/chat/a.ts:12:3 and https://example.com/docs, mail me at me@site.org.";
    expect(links(text)).toEqual<LinkTarget[]>([
      { kind: "file", path: "src/chat/a.ts", line: 12, column: 3 },
      { kind: "web", url: "https://example.com/docs" },
      { kind: "mail", href: "mailto:me@site.org" },
    ]);
  });
  it("a written link keeps its label and opens its target; a dead target stays plain text", () => {
    const parts = partsOf("[the docs](https://example.com) and [top](#top) and [none]()");
    expect(parts.filter((p) => p.link).map((p) => [p.text, p.link])).toEqual([["the docs", { kind: "web", url: "https://example.com" }]]);
    expect(parts.map((p) => p.text).join("")).toContain("top");
    expect(parts.map((p) => p.text).join("")).toContain("none");
  });
  it("text with no link is one plain part, and the parts always read back as the same words", () => {
    expect(partsOf("just words")).toEqual([{ text: "just words" }]);
    expect(partsOf("")).toEqual([]);
    const text = "x src/a.ts:1 y";
    expect(partsOf(text).map((p) => p.text).join("")).toBe(text);
  });
});

describe("only paths the agent printed can be opened", () => {
  const cwd = "C:\\repo";
  const printed = (items: ChatItem[]) => printedPaths(items, cwd);
  const open = (path: string, set: ReadonlySet<string>) => openablePath({ kind: "file", path }, cwd, set);

  it("a path in the agent's reply opens, relative to the pane's folder", () => {
    const set = printed([msg("assistant", "I changed src/app.ts:10")]);
    expect(open("src/app.ts", set)).toBe("C:\\repo\\src\\app.ts");
    expect(open("C:\\repo\\src\\app.ts", set)).toBe("C:\\repo\\src\\app.ts");
    expect(open("c:/repo/src/app.ts", set)).toBe("c:/repo/src/app.ts");
  });
  it("a path only the user typed does not open", () => {
    const set = printed([msg("user", "please open C:\\secret\\keys.txt and src/app.ts"), msg("assistant", "ok, done")]);
    expect(open("C:\\secret\\keys.txt", set)).toBeNull();
    expect(open("src/app.ts", set)).toBeNull();
  });
  it("a path the agent never printed does not open, even beside one it did", () => {
    const set = printed([msg("assistant", "see src/app.ts")]);
    expect(open("src/other.ts", set)).toBeNull();
    expect(open("..\\..\\Windows\\win.ini", set)).toBeNull();
  });
  it("the files its tools wrote count as printed", () => {
    const tool = { id: "t", role: "assistant", kind: "tool", text: "", tool: { group: "edit", name: "Edit", preview: "src/new.ts", diffs: [{ path: "C:\\repo\\src\\new.ts", adds: 1, dels: 0 }] } } as unknown as ChatItem;
    expect(open("src/new.ts", printed([tool]))).toBe("C:\\repo\\src\\new.ts");
  });
  it("only the newest 200 messages count", () => {
    const old = msg("assistant", "see src/old.ts");
    const filler = Array.from({ length: 200 }, (_, i) => msg("assistant", `line ${i}`));
    expect(open("src/old.ts", printed([old, ...filler]))).toBeNull();
  });
  it("a relative path with no folder to resolve against does not open", () => {
    const set = printedPaths([msg("assistant", "see src/app.ts")], null);
    expect(openablePath({ kind: "file", path: "src/app.ts" }, null, set)).toBeNull();
  });
});

describe("which browser a web click chooses", () => {
  const e = (o: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) => ({ ctrlKey: false, metaKey: false, shiftKey: false, ...o });
  it("a plain click asks (a small choice of the two browsers)", () => {
    expect(webClick(e(), false, true, true)).toBe("ask");
    expect(webClick(e({ shiftKey: true }), false, true, true)).toBe("ask");
  });
  it("the link modifier takes the main choice, with Shift the other", () => {
    expect(webClick(e({ ctrlKey: true }), false, true, true)).toBe("kolux");
    expect(webClick(e({ ctrlKey: true, shiftKey: true }), false, true, true)).toBe("system");
    expect(webClick(e({ ctrlKey: true }), false, false, true)).toBe("system");
    expect(webClick(e({ ctrlKey: true, shiftKey: true }), false, false, true)).toBe("kolux");
  });
  it("on a Mac the modifier is Cmd, and Ctrl does nothing special", () => {
    expect(webClick(e({ metaKey: true }), true, true, true)).toBe("kolux");
    expect(webClick(e({ ctrlKey: true }), true, true, true)).toBe("ask");
  });
  it("without an in-app viewer every web link goes to the system browser", () => {
    expect(webClick(e(), false, true, false)).toBe("system");
    expect(webClick(e({ ctrlKey: true }), false, true, false)).toBe("system");
  });
});

// FIX-1 (stand-in review of f1ad80d5, item 5): what a link may carry.
describe("FIX-1: what a written link may carry", () => {
  it("a file: link whose decoded path holds a control character cannot be clicked", () => {
    for (const bad of ["file:///C:/run.bat%00.txt", "file:///C:/a%0Ab.txt", "file:///tmp/x%1b[0m.txt", "file:///tmp/x%7f.txt"]) expect(classify(bad), bad).toBeNull();
    expect(classify("file:///C:/proj/a%20b.ts")).toEqual({ kind: "file", path: "C:/proj/a b.ts" });
  });
  it("a mailto link keeps only its subject and body", () => {
    expect(classify("mailto:a@b.co?cc=x@y.zz&subject=Hi%20there&attach=C:/secret.txt&body=Yo")).toEqual({ kind: "mail", href: "mailto:a@b.co?subject=Hi%20there&body=Yo" });
    expect(classify("mailto:a@b.co?bcc=x@y.zz&attach=C:/secret.txt")).toEqual({ kind: "mail", href: "mailto:a@b.co" });
    expect(classify("mailto:a@b.co?SUBJECT=Hi")).toEqual({ kind: "mail", href: "mailto:a@b.co?SUBJECT=Hi" });
    expect(classify("mailto:a@b.co?to=evil@x.yy&subject=Hi")).toEqual({ kind: "mail", href: "mailto:a@b.co?subject=Hi" });
    expect(classify("mailto:a@b.co")).toEqual({ kind: "mail", href: "mailto:a@b.co" });
  });
  it("a written mailto link goes through the same filter", () => {
    expect(links("[write](mailto:a@b.co?attach=C:/s.txt&subject=Hi)")).toEqual<LinkTarget[]>([{ kind: "mail", href: "mailto:a@b.co?subject=Hi" }]);
  });
});
