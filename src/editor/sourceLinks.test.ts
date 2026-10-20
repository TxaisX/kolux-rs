import { describe, expect, it } from "vitest";
import { followSpan, linkSpans, spanAt } from "./sourceLinks";

// EDIT-014 (T-234-b): note links in source view.
describe("link spans", () => {
  it("finds markdown links and [[notes]], not images", () => {
    const line = "see [docs](a/b.md) and ![pic](p.png) and [[Other note]] end";
    const s = linkSpans(line);
    expect(s.map((x) => line.slice(x.from, x.to))).toEqual(["[docs](a/b.md)", "[[Other note]]"]);
    expect(s[0]).toMatchObject({ kind: "md", href: "a/b.md" });
    expect(s[1]).toMatchObject({ kind: "wiki", name: "Other note" });
  });
  it("takes the address before a title and inside angle brackets", () => {
    expect(linkSpans('[a](x.md "the title")')[0]).toMatchObject({ href: "x.md" });
    expect(linkSpans("[a](<x.md>)")[0]).toMatchObject({ href: "x.md" });
  });
  it("never spans a line break and finds nothing in plain text", () => {
    expect(linkSpans("[a]\n(b)")).toEqual([]);
    expect(linkSpans("no links here")).toEqual([]);
    expect(linkSpans("[[a\nb]]")).toEqual([]);
  });
  it("spanAt: inside yes, past the end no", () => {
    const line = "go [a](x.md) now";
    expect(spanAt(line, 3)).not.toBeNull();
    expect(spanAt(line, 11)).not.toBeNull();
    expect(spanAt(line, 12)).toBeNull();
    expect(spanAt(line, 0)).toBeNull();
  });
});

// the shared resolver writes Windows paths with backslashes
const slash = (r: ReturnType<typeof followSpan>) => ("action" in r && r.action.kind === "file" ? { action: { ...r.action, path: r.action.path.split(String.fromCharCode(92)).join("/") } } : r);

describe("following a span", () => {
  const files = ["notes/Plan.md", "a/index.md", "b/index.md", "docs/Guide.md"];
  const root = "C:/work/proj";
  it("a markdown link goes through the same rules as a click in the rich view", () => {
    const r = followSpan({ from: 0, to: 1, kind: "md", href: "docs/Guide.md" }, "C:/work/proj/readme.md", root, files);
    expect(slash(r)).toEqual({ action: { kind: "file", path: "C:/work/proj/docs/Guide.md", how: "preview" } });
    expect(slash(followSpan({ from: 0, to: 1, kind: "md", href: "my%20note.md" }, "C:/work/proj/readme.md", root, files))).toMatchObject({ action: { path: "C:/work/proj/my note.md" } });
  });
  it("[[note]] opens the one note it names, with its heading", () => {
    expect(followSpan({ from: 0, to: 1, kind: "wiki", name: "plan#Goals" }, "x", root, files)).toEqual({ action: { kind: "file", path: "C:/work/proj/notes/Plan.md", heading: "Goals", how: "preview" } });
  });
  it("a shared name is flagged and a missing one says so; neither guesses", () => {
    expect(followSpan({ from: 0, to: 1, kind: "wiki", name: "index" }, "x", root, files)).toEqual({ toast: "2 notes are named index; use a link with the folder to pick one." });
    expect(followSpan({ from: 0, to: 1, kind: "wiki", name: "nothing" }, "x", root, files)).toEqual({ toast: "No note named nothing." });
  });
});
