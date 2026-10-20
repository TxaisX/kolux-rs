// EDIT-057 (T-237-b): the collapsible section of the rich markdown view. It is the markdown note's own
//   <details>
//   <summary>Title</summary>
//
//   body
//
//   </details>
// block: a title line and a body of ordinary blocks. In the editor it is a native <details> element that
// is always open (a closed one could not be edited), so the browser does the folding. Only this exact shape
// is read; any other <details> (an `open` attribute, a title over several lines) stays in source view.
import {
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  ElementNode,
  type EditorConfig,
  type LexicalNode,
  type RangeSelection,
  type SerializedElementNode,
} from "lexical";
import { $convertFromMarkdownString, $convertToMarkdownString, type MultilineElementTransformer, type Transformer } from "@lexical/markdown";

export class SummaryNode extends ElementNode {
  static getType() {
    return "kolux-summary";
  }
  static clone(n: SummaryNode) {
    return new SummaryNode(n.__key);
  }
  static importJSON(j: SerializedElementNode) {
    return new SummaryNode().updateFromJSON(j);
  }
  createDOM(_c: EditorConfig) {
    const s = document.createElement("summary");
    s.className = "md-summary";
    return s;
  }
  updateDOM() {
    return false;
  }
  isInline() {
    return false;
  }
  // Enter in the title starts the body: a new paragraph at the top of it.
  insertNewAfter(_sel: RangeSelection, _restore?: boolean) {
    const body = this.getNextSibling();
    const p = $createParagraphNode();
    if ($isBodyNode(body)) body.splice(0, 0, [p]);
    else this.insertAfter(p);
    return p;
  }
}

export class BodyNode extends ElementNode {
  static getType() {
    return "kolux-details-body";
  }
  static clone(n: BodyNode) {
    return new BodyNode(n.__key);
  }
  static importJSON(j: SerializedElementNode) {
    return new BodyNode().updateFromJSON(j);
  }
  createDOM(_c: EditorConfig) {
    const d = document.createElement("div");
    d.className = "md-details-body";
    return d;
  }
  updateDOM() {
    return false;
  }
  isInline() {
    return false;
  }
}

export class DetailsNode extends ElementNode {
  static getType() {
    return "kolux-details";
  }
  static clone(n: DetailsNode) {
    return new DetailsNode(n.__key);
  }
  static importJSON(j: SerializedElementNode) {
    return new DetailsNode().updateFromJSON(j);
  }
  createDOM(_c: EditorConfig) {
    const d = document.createElement("details");
    d.className = "md-details";
    d.open = true;
    return d;
  }
  updateDOM() {
    return false;
  }
  isInline() {
    return false;
  }
}

export const DETAILS_NODES = [DetailsNode, SummaryNode, BodyNode];
export const $isDetailsNode = (n: LexicalNode | null | undefined): n is DetailsNode => n instanceof DetailsNode;
export const $isSummaryNode = (n: LexicalNode | null | undefined): n is SummaryNode => n instanceof SummaryNode;
export const $isBodyNode = (n: LexicalNode | null | undefined): n is BodyNode => n instanceof BodyNode;

const OPEN = /^<details>[ \t]*$/i;
const CLOSE = /^<\/details>[ \t]*$/i;
const TITLE = /^<summary>([^<>\n]*)<\/summary>[ \t]*$/i;

/** A collapsible section made of a title and a body paragraph, empty. */
export function $createDetails(title: string): DetailsNode {
  const d = new DetailsNode();
  const s = new SummaryNode();
  if (title) s.append($createTextNode(title));
  const b = new BodyNode();
  b.append($createParagraphNode());
  d.append(s, b);
  return d;
}

/** Puts a collapsible section after the block holding the caret (in place of an empty paragraph), keeps a
 * paragraph after it so the caret can leave it, and selects its title. False when there is no caret. */
export function $insertDetails(title = "Section"): boolean {
  const sel = $getSelection();
  if (!$isRangeSelection(sel)) return false;
  const top = sel.anchor.getNode().getTopLevelElementOrThrow();
  const d = $createDetails(title);
  if (top.isEmpty() && top.getType() === "paragraph") top.replace(d);
  else top.insertAfter(d);
  if (!d.getNextSibling()) d.insertAfter($createParagraphNode());
  const t = d.getFirstChild<SummaryNode>()?.getFirstChild();
  if (t && "select" in t) (t as ReturnType<typeof $createTextNode>).select(0, title.length);
  return true;
}

/** The markdown transformer for the section. `all` is the full list (itself included), for the body's text. */
export function makeDetails(all: () => Transformer[]): MultilineElementTransformer {
  return {
    dependencies: DETAILS_NODES,
    regExpStart: OPEN,
    handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex }) => {
      const head = TITLE.exec(lines[startLineIndex + 1] ?? "");
      if (!head) return null;
      // The matching close, counting sections inside the body.
      let depth = 1;
      let end = -1;
      for (let i = startLineIndex + 2; i < lines.length; i++) {
        if (OPEN.test(lines[i])) depth++;
        else if (CLOSE.test(lines[i]) && --depth === 0) {
          end = i;
          break;
        }
      }
      if (end < 0) return null;
      const d = new DetailsNode();
      const s = new SummaryNode();
      if (head[1]) s.append($createTextNode(head[1]));
      const b = new BodyNode();
      const text = lines.slice(startLineIndex + 2, end).join("\n").replace(/^\s*\n/, "").replace(/\n\s*$/, "");
      if (text.trim()) $convertFromMarkdownString(text, all(), b);
      if (!b.getFirstChild()) b.append($createParagraphNode());
      d.append(s, b);
      rootNode.append(d);
      return [true, end];
    },
    replace: () => false,
    export: (node) => {
      if (!$isDetailsNode(node)) return null;
      const kids = node.getChildren();
      const title = kids.find($isSummaryNode)?.getTextContent().replace(/[<>\n]/g, " ") ?? "";
      const body = kids.find($isBodyNode);
      const text = body ? $convertToMarkdownString(all(), body).replace(/^\n+|\n+$/g, "") : "";
      return `<details>\n<summary>${title}</summary>\n\n${text ? text + "\n\n" : ""}</details>`;
    },
    type: "multiline-element",
  };
}

/** `md` without the open and close lines of sections in the shape the rich view reads (so the HTML check does not flag them). */
export const withoutSections = (md: string): string =>
  md.replace(/^<details>[ \t]*\r?\n<summary>[^<>\n]*<\/summary>[ \t]*$/gim, "").replace(/^<\/details>[ \t]*$/gim, "");
