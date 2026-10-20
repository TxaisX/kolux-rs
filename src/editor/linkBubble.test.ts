import { describe, expect, it } from "vitest";
import { $getRoot, createEditor, type LexicalEditor } from "lexical";
import { LinkNode } from "@lexical/link";
import { $convertFromMarkdownString, $convertToMarkdownString, TRANSFORMERS } from "@lexical/markdown";
import { bubblePlace, cleanHref, setLinkUrl } from "./linkBubble";

// EDIT-014 (T-234-b): the hover bubble of a link.
const mk = (md: string): LexicalEditor => {
  const ed = createEditor({ namespace: "b", nodes: [LinkNode], onError: (e) => { throw e; } });
  ed.update(() => $convertFromMarkdownString(md, TRANSFORMERS), { discrete: true });
  return ed;
};
const out = (ed: LexicalEditor) => ed.getEditorState().read(() => $convertToMarkdownString(TRANSFORMERS));
const linkKey = (ed: LexicalEditor) =>
  ed.getEditorState().read(() => {
    const walk = (n: { getKey(): string; getType(): string; getChildren?: () => unknown[] }): string | null => {
      if (n.getType() === "link") return n.getKey();
      for (const c of n.getChildren?.() ?? []) { const k = walk(c as never); if (k) return k; }
      return null;
    };
    return walk($getRoot() as never);
  });

describe("bubble place", () => {
  const size = { w: 200, h: 36 };
  const view = { w: 1000, h: 700 };
  it("sits above the link", () => {
    expect(bubblePlace({ left: 300, top: 200, right: 360, bottom: 218 }, size, view)).toEqual({ left: 300, top: 158, above: true });
  });
  it("flips below when the link is at the top of the window", () => {
    const p = bubblePlace({ left: 300, top: 10, right: 360, bottom: 28 }, size, view);
    expect(p.above).toBe(false);
    expect(p.top).toBe(34);
  });
  it("stays inside the window sideways", () => {
    expect(bubblePlace({ left: 950, top: 200, right: 990, bottom: 218 }, size, view).left).toBe(792);
    expect(bubblePlace({ left: -20, top: 200, right: 10, bottom: 218 }, size, view).left).toBe(8);
  });
  it("never goes below the window bottom", () => {
    const p = bubblePlace({ left: 300, top: 5, right: 360, bottom: 690 }, size, view);
    expect(p.top).toBe(664);
  });
});

describe("edited addresses", () => {
  it("trims, writes spaces as %20 and refuses empty or script-bearing ones", () => {
    expect(cleanHref("  notes/my file.md ")).toBe("notes/my%20file.md");
    expect(cleanHref("https://example.com/a")).toBe("https://example.com/a");
    expect(cleanHref("   ")).toBeNull();
    expect(cleanHref("javascript:alert(1)")).toBeNull();
    expect(cleanHref(" JaVa script:x")).toBeNull();
    expect(cleanHref("data:text/html,x")).toBeNull();
    expect(cleanHref("a\nb")).toBeNull();
  });
});

describe("rewriting a link", () => {
  it("changes the address and keeps the words", () => {
    const ed = mk("see [the docs](old.md) now");
    expect(setLinkUrl(ed, linkKey(ed)!, "new folder/new.md")).toBe(true);
    expect(out(ed)).toBe("see [the docs](new%20folder/new.md) now");
  });
  it("refuses a bad address and an unchanged one, leaving the note as it was", () => {
    const ed = mk("[a](x.md)");
    expect(setLinkUrl(ed, linkKey(ed)!, "javascript:1")).toBe(false);
    expect(setLinkUrl(ed, linkKey(ed)!, "x.md")).toBe(false);
    expect(out(ed)).toBe("[a](x.md)");
  });
});
