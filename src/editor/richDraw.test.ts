import { describe, expect, it } from "vitest";
import { $getRoot, $isElementNode, createEditor, type LexicalEditor } from "lexical";
import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { ListItemNode, ListNode } from "@lexical/list";
import { $convertFromMarkdownString, $convertToMarkdownString, TRANSFORMERS } from "@lexical/markdown";
import { allDrawable, diagramPanel, drawable, drawnAtCaret, mathHtml } from "./richDraw";

// EDIT-029 / EDIT-030 (T-235-b): what the rich view draws under the caret, and that the note text is never touched.
const mk = (md: string): LexicalEditor => {
  const ed = createEditor({ namespace: "d", nodes: [CodeNode, CodeHighlightNode, ListNode, ListItemNode], onError: (e) => { throw e; } });
  ed.update(() => $convertFromMarkdownString(md, TRANSFORMERS), { discrete: true });
  return ed;
};
const caretIn = (ed: LexicalEditor, index: number) =>
  ed.update(() => { const n = $getRoot().getChildren()[index]; if ($isElementNode(n)) n.selectStart(); }, { discrete: true });
const out = (ed: LexicalEditor) => ed.getEditorState().read(() => $convertToMarkdownString(TRANSFORMERS));

const NOTE = "Intro\n\n```mermaid\ngraph TD\n  A-->B\n```\n\nEnergy $E=mc^2$ here\n\n```js\nconst a = '$x$';\n```\n\n- item $y$ in a list";

describe("drawable", () => {
  it("takes a mermaid fence under any spelling of the label, and not other fences", () => {
    expect(drawable("mermaid", "graph TD", true)).toEqual({ kind: "mermaid", src: "graph TD" });
    expect(drawable("Mermaid", "graph TD", true)?.kind).toBe("mermaid");
    expect(drawable("js", "const a = '$x$'", true)).toBeNull();
    expect(drawable("mermaid", "   ", true)).toBeNull();
  });

  it("finds inline and block maths in text but not money or plain text", () => {
    expect(drawable(null, "Energy $E=mc^2$ here", false)).toMatchObject({ kind: "math", items: [{ tex: "E=mc^2", display: false }] });
    expect(drawable(null, "$$\\int_0^1 x\\,dx$$", false)).toMatchObject({ kind: "math", items: [{ display: true }] });
    expect(drawable(null, "it costs $5 and $10", false)).toBeNull();
    expect(drawable(null, "no maths", false)).toBeNull();
  });
});

describe("the block under the caret", () => {
  it("is the mermaid fence when the caret is inside it", () => {
    const ed = mk(NOTE);
    caretIn(ed, 1);
    expect(drawnAtCaret(ed)).toMatchObject({ kind: "mermaid", src: "graph TD\n  A-->B" });
  });

  it("is the paragraph's maths when the caret is in it, and nothing in Intro or a code fence that only holds dollars", () => {
    const ed = mk(NOTE);
    caretIn(ed, 2);
    expect(drawnAtCaret(ed)).toMatchObject({ kind: "math", items: [{ tex: "E=mc^2" }] });
    caretIn(ed, 0);
    expect(drawnAtCaret(ed)).toBeNull();
    caretIn(ed, 3);
    expect(drawnAtCaret(ed)).toBeNull();
  });

  it("reaches maths inside a list item", () => {
    const ed = mk(NOTE);
    caretIn(ed, 4);
    ed.update(() => { const li = ($getRoot().getChildren()[4] as unknown as { getFirstChild(): { selectStart(): void } }).getFirstChild(); li.selectStart(); }, { discrete: true });
    expect(drawnAtCaret(ed)).toMatchObject({ kind: "math", items: [{ tex: "y" }] });
  });

  it("lists every drawable block in order and never changes the note text", () => {
    const ed = mk(NOTE);
    const before = out(ed);
    expect(allDrawable(ed).map((d) => d.kind)).toEqual(["mermaid", "math", "math"]);
    caretIn(ed, 1);
    drawnAtCaret(ed);
    expect(out(ed)).toBe(before);
    expect(before).toContain("```mermaid\ngraph TD\n  A-->B\n```");
    expect(before).toContain("$E=mc^2$");
  });
});

describe("panel bodies", () => {
  it("renders maths through the plugged-in renderer, block maths as a block, and falls back to the source on bad TeX", () => {
    const items = [{ tex: "x^2", display: false, raw: "$x^2$" }, { tex: "\\bad", display: true, raw: "$$\\bad$$" }];
    const html = mathHtml(items, (tex) => { if (tex === "\\bad") throw new Error("parse"); return `<i>${tex}</i>`; });
    expect(html).toContain('<span class="md-math"><i>x^2</i></span>');
    expect(html).toContain('md-math-src');
    expect(html).toContain("$$\\bad$$");
  });

  it("shows the source text, escaped, when no renderer is plugged in", () => {
    const html = mathHtml([{ tex: "a<b", display: false, raw: "$a<b$" }], undefined);
    expect(html).not.toContain("<b");
    expect(html).toContain("a&lt;b");
  });

  it("gives the locked page for a drawn diagram and a one-line reason for a failed or missing one", async () => {
    const ok = await diagramPanel("graph TD", true, async () => '<svg viewBox="0 0 200 100"><rect/></svg>', (x) => x);
    expect("srcdoc" in ok && ok.srcdoc).toContain("default-src 'none'");
    expect("ratio" in ok && ok.ratio).toBe("200 / 100");
    const bad = await diagramPanel("nonsense", true, async () => { throw new Error("Parse error on line 1\nmore"); });
    expect(bad).toEqual({ error: "Diagram could not be drawn: Parse error on line 1" });
    expect(await diagramPanel("x", true, undefined)).toEqual({ error: "Diagrams are not available yet." });
  });
});
