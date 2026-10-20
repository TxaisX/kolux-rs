// EDIT-029 / EDIT-030 (T-235-b): diagrams and maths in the rich view. The note's own text is never changed:
// the block under the caret (a mermaid code block, or a paragraph holding $maths$ / $$ blocks) is drawn in a
// floating panel just below it, so the file round-trips exactly as written. The drawing itself is the
// preview's (diagrams.ts): mermaid in strict mode into an empty-sandbox iframe, KaTeX with trust off.
import { $getRoot, $getSelection, $isRangeSelection, $isElementNode, type LexicalEditor, type LexicalNode } from "lexical";
import { $isCodeNode } from "@lexical/code";
import { canonLanguage } from "./richCode";
import { cleanSvg, diagramFrame, esc, extractMath, getRenderers, restoreMath, type MathItem } from "./diagrams";

export type Drawn = { kind: "mermaid"; key: string; src: string } | { kind: "math"; key: string; items: MathItem[] };

/** What is worth drawing in a block: a mermaid fence's text, or the maths spans a text block holds. */
export function drawable(language: string | null, text: string, isCode: boolean): { kind: "mermaid"; src: string } | { kind: "math"; items: MathItem[] } | null {
  if (isCode) return canonLanguage(language) === "mermaid" && text.trim() ? { kind: "mermaid", src: text } : null;
  if (!text.includes("$")) return null;
  const { items } = extractMath(text);
  return items.length > 0 ? { kind: "math", items } : null;
}

/** The drawable block the caret is in (null when it is elsewhere, or the note is not being edited). */
export function drawnAtCaret(editor: LexicalEditor): Drawn | null {
  return editor.getEditorState().read(() => {
    const sel = $getSelection();
    if (!$isRangeSelection(sel)) return null;
    const top = sel.anchor.getNode().getTopLevelElement();
    if (!top) return null;
    // a list or quote holds paragraphs: use the innermost block that carries the text
    const block = $isCodeNode(top) || !$isElementNode(top) ? top : (sel.anchor.getNode().getParent() ?? top);
    const d = drawable($isCodeNode(top) ? top.getLanguage() ?? "" : null, $isCodeNode(top) ? top.getTextContent() : block.getTextContent(), $isCodeNode(top));
    if (!d) return null;
    return d.kind === "mermaid" ? { kind: "mermaid", key: top.getKey(), src: d.src } : { kind: "math", key: block.getKey(), items: d.items };
  });
}

/** Every drawable block of the note in order (for tests and for a future whole-note draw). */
export function allDrawable(editor: LexicalEditor): Drawn[] {
  return editor.getEditorState().read(() => {
    const out: Drawn[] = [];
    const walk = (n: LexicalNode) => {
      if ($isCodeNode(n)) {
        const d = drawable(n.getLanguage() ?? "", n.getTextContent(), true);
        if (d?.kind === "mermaid") out.push({ kind: "mermaid", key: n.getKey(), src: d.src });
        return;
      }
      if ($isElementNode(n)) {
        const kids = n.getChildren();
        if (kids.some($isElementNode)) kids.forEach(walk);
        else {
          const d = drawable(null, n.getTextContent(), false);
          if (d?.kind === "math") out.push({ kind: "math", key: n.getKey(), items: d.items });
        }
      }
    };
    walk($getRoot());
    return out;
  });
}

/** The panel body for maths: each span rendered by the plugged-in renderer, or its source text when there is none. */
export function mathHtml(items: MathItem[], render = getRenderers().math): string {
  return items.map((it) => restoreMath(`KXMATH0X`, [it], render)).join("");
}

/** The panel body for a diagram: the cleaned SVG as the locked frame's page, or the reason it failed. */
export async function diagramPanel(src: string, dark: boolean, draw = getRenderers().mermaid, clean = cleanSvg): Promise<{ srcdoc: string; ratio: string; maxWidth: number } | { error: string }> {
  if (!draw) return { error: "Diagrams are not available yet." };
  try {
    return diagramFrame(clean(await draw(src, dark)));
  } catch (err) {
    return { error: `Diagram could not be drawn: ${String(err instanceof Error ? err.message : err).split("\n")[0].slice(0, 160)}` };
  }
}

export const panelError = (m: string) => `<div class="md-diagram-error">${esc(m)}</div>`;
