import { describe, expect, it } from "vitest";
import { headingLine, headingSlugs, resolveLink, slugOf, splitAnchor, wikiLinks, wikiMatches, wikiSuggest, wikiTarget } from "./noteLinks";

// EDIT-014 (T-234-b): what a link in a note means.
const ROOT = String.raw`C:\w`;
const NOTE = String.raw`C:\w\docs\a.md`;

describe("line anchors", () => {
  it("#L10, #L10C5 and :10:5 are accepted", () => {
    expect(splitAnchor("src/x.ts#L10")).toEqual({ path: "src/x.ts", line: 10 });
    expect(splitAnchor("src/x.ts#L10C5")).toEqual({ path: "src/x.ts", line: 10, col: 5 });
    expect(splitAnchor("src/x.ts:10:5")).toEqual({ path: "src/x.ts", line: 10, col: 5 });
    expect(splitAnchor("src/x.ts:10")).toEqual({ path: "src/x.ts", line: 10 });
  });

  it("a Windows drive letter is never a line number", () => {
    expect(splitAnchor(String.raw`C:\w\x.ts`)).toEqual({ path: String.raw`C:\w\x.ts` });
    expect(splitAnchor("C:/w/x.ts:7")).toEqual({ path: "C:/w/x.ts", line: 7 });
    expect(splitAnchor("C:10")).toEqual({ path: "C:10" });
  });

  it("a heading anchor is kept as the heading", () => {
    expect(splitAnchor("b.md#Some-Heading")).toEqual({ path: "b.md", heading: "Some-Heading" });
  });
});

describe("heading anchors follow GitHub's slugs", () => {
  it("lower case, marks dropped, spaces to hyphens, repeats numbered", () => {
    expect(slugOf("Hello, World! (v2)")).toBe("hello-world-v2");
    expect(slugOf("Naïve  café_ok-1")).toBe("naïve--café_ok-1");
    expect(headingSlugs("# A\n## B\n## B\n## B\n")).toEqual(["a", "b", "b-1", "b-2"]);
  });

  it("the line of a heading, skipping code fences, with the numbered repeat", () => {
    const md = "# Top\n```\n# not a heading\n```\n## Part\ntext\n## Part\n";
    expect(headingLine(md, "top")).toBe(1);
    expect(headingLine(md, "not-a-heading")).toBeNull();
    expect(headingLine(md, "part")).toBe(5);
    expect(headingLine(md, "part-1")).toBe(7);
    expect(headingLine(md, "nope")).toBeNull();
  });
});

describe("what a click does", () => {
  it("web links go to a browser, other schemes do nothing", () => {
    expect(resolveLink("https://example.com/a?b=1#c", NOTE, ROOT)).toEqual({ kind: "web", url: "https://example.com/a?b=1#c" });
    expect(resolveLink("mailto:a@b.c", NOTE, ROOT)).toEqual({ kind: "none" });
    expect(resolveLink("javascript:alert(1)", NOTE, ROOT)).toEqual({ kind: "none" });
  });

  it("a relative markdown link in the worktree opens as a preview; either slash direction means the same", () => {
    const want = { kind: "file", path: String.raw`C:\w\docs\b.md`, how: "preview" };
    expect(resolveLink("b.md", NOTE, ROOT)).toEqual(want);
    expect(resolveLink(".\\b.md", NOTE, ROOT)).toEqual(want);
    expect(resolveLink("../other/c.md", NOTE, ROOT)).toEqual({ kind: "file", path: String.raw`C:\w\other\c.md`, how: "preview" });
  });

  it("a line anchor, another kind of file or a note outside the worktree opens as an editor tab", () => {
    expect(resolveLink("b.md#L10", NOTE, ROOT)).toMatchObject({ how: "editor", line: 10 });
    expect(resolveLink("../src/x.ts:12:3", NOTE, ROOT)).toEqual({ kind: "file", path: String.raw`C:\w\src\x.ts`, line: 12, col: 3, how: "editor" });
    expect(resolveLink(String.raw`D:\elsewhere\n.md`, NOTE, ROOT)).toMatchObject({ how: "editor" });
    expect(resolveLink("../../up.md", NOTE, ROOT)).toMatchObject({ how: "editor" }); // above the worktree
  });

  it("an anchor into the open note moves within that tab", () => {
    expect(resolveLink("#some-heading", NOTE, ROOT)).toEqual({ kind: "here", heading: "some-heading" });
    expect(resolveLink("#L4", NOTE, ROOT)).toEqual({ kind: "here", line: 4 });
    expect(resolveLink("a.md#intro", NOTE, ROOT)).toEqual({ kind: "here", heading: "intro" });
    expect(resolveLink(String.raw`C:\W\DOCS\a.md#L9`, NOTE, ROOT)).toEqual({ kind: "here", line: 9 });
  });

  it("file links: a drive path, localhost counts as local, a network share keeps its server", () => {
    expect(resolveLink("file:///C:/w/docs/z.ts#L3", NOTE, ROOT)).toMatchObject({ path: "C:/w/docs/z.ts", line: 3, how: "editor" });
    expect(resolveLink("file://localhost/C:/w/docs/z.md", NOTE, ROOT)).toMatchObject({ path: "C:/w/docs/z.md", how: "preview" });
    expect(resolveLink("file://srv/share/n.md", NOTE, ROOT)).toMatchObject({ path: String.raw`\\srv\share\n.md`, how: "editor" });
  });

  it("with no worktree nothing opens as a preview", () => {
    expect(resolveLink("b.md", NOTE, null)).toMatchObject({ how: "editor" });
  });
});

describe("[[note]] links", () => {
  it("are found with their offsets and never span a line break", () => {
    const t = "see [[Alpha]] and [[b/Beta#Intro]]\nbroken [[Gam\nma]] done [[x|label]]";
    expect(wikiLinks(t).map((l) => l.name)).toEqual(["Alpha", "b/Beta#Intro", "x"]);
    expect(t.slice(wikiLinks(t)[0].from, wikiLinks(t)[0].to)).toBe("[[Alpha]]");
    expect(wikiTarget("b/Beta#Intro")).toEqual({ note: "b/Beta", heading: "Intro" });
  });

  it("a name that fits more than one file is flagged, not guessed", () => {
    const files = ["a/Plan.md", "b/Plan.md", "Notes.md", "x/y/notes.txt", "c/Other.md"];
    expect(wikiMatches(files, "plan")).toEqual({ matches: ["a/Plan.md", "b/Plan.md"], ambiguous: true });
    expect(wikiMatches(files, "b/plan")).toEqual({ matches: ["b/Plan.md"], ambiguous: false });
    expect(wikiMatches(files, "Notes.md").matches).toEqual(["Notes.md"]);
    expect(wikiMatches(files, "ghost")).toEqual({ matches: [], ambiguous: false });
  });

  it("[[ lists the notes that start with what was typed first, then those that contain it", () => {
    const files = ["docs/Alpha.md", "docs/Beta.md", "x/alphabet.md", "pic.png", "Gamma-alpha.md"];
    expect(wikiSuggest(files, "alp")).toEqual(["docs/Alpha.md", "x/alphabet.md", "Gamma-alpha.md"]);
    expect(wikiSuggest(files, "")).toHaveLength(4);
    expect(wikiSuggest(files, "zzz")).toEqual([]);
  });
});
