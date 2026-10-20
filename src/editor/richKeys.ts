// EDIT-010 / EDIT-014 (T-234-b): keys of the rich view that Lexical does not do on its own.
//  - Cut with nothing selected takes the whole block at the caret: a paragraph, a list item together with
//    its sub-list, or one visual line of a hard-wrapped paragraph (lines joined by line breaks).
//  - Backspace or Delete in an empty paragraph beside a table, a collapsible section or a code block removes
//    the empty paragraph cleanly and puts the caret in that block, instead of leaving the stray line.
//  - Mod+K asks the toolbar to open its Link box (the same box as the Link button).
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isParagraphNode,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  CUT_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_MODIFIER_COMMAND,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { $isListItemNode, $isListNode, type ListItemNode } from "@lexical/list";
import { $findMatchingParent, mergeRegister } from "@lexical/utils";
import { $isTableNode } from "./richTable";
import { $isDetailsNode } from "./richDetails";
import { $isCodeNode } from "@lexical/code";

/** Fired on the document when Mod+K is pressed in a rich view; `detail` is that view's root element. */
export const LINK_EVENT = "kolux:rich-link";

/** Removes the block at the caret and returns its text, or null when the caret is not in a block this
 *  covers (a table, a code block and a collapsible section are left to their own keys) or something is selected.
 *  Call inside an editor update. */
export function $cutAtCaret(): string | null {
  const sel = $getSelection();
  if (!$isRangeSelection(sel) || !sel.isCollapsed()) return null;
  const at = sel.anchor.getNode();
  const item = $findMatchingParent(at, $isListItemNode);
  if (item) {
    // an item's sub-list is a following item that holds only a list: it goes with the item
    const parts: ListItemNode[] = [item];
    for (let n = item.getNextSibling(); $isListItemNode(n) && n.getChildren().length === 1 && $isListNode(n.getFirstChild()); n = n.getNextSibling()) parts.push(n);
    const text = parts.map((p) => p.getTextContent()).join("\n");
    const next = item.getPreviousSibling() ?? parts[parts.length - 1].getNextSibling();
    const list = item.getParent();
    for (const p of parts) p.remove();
    if (next && $isElementNode(next)) next.selectEnd();
    else if (list && list.isAttached()) list.selectEnd();
    return text;
  }
  const top = at.getTopLevelElement();
  if (!top || !$isElementNode(top) || $isTableNode(top) || $isDetailsNode(top) || $isCodeNode(top)) return null;
  if (!$isParagraphNode(top) || !top.getChildren().some($isLineBreakNode)) return $removeBlock(top);
  // a hard-wrapped paragraph: the visual line the caret is on, with one line break beside it
  const kids = top.getChildren();
  let i = at === top ? Math.min(sel.anchor.offset, kids.length - 1) : kids.indexOf($childOf(at, top));
  if (i < 0) i = 0;
  if ($isLineBreakNode(kids[i]) && i > 0 && !$isLineBreakNode(kids[i - 1])) i--; // a caret on a break belongs to the line before it
  if ($isLineBreakNode(kids[i])) {
    kids[i].remove(); // an empty line
    top.select(i, i);
    return "";
  }
  let a = i;
  let b = i;
  while (a > 0 && !$isLineBreakNode(kids[a - 1])) a--;
  while (b < kids.length - 1 && !$isLineBreakNode(kids[b + 1])) b++;
  const text = kids.slice(a, b + 1).map((n) => n.getTextContent()).join("");
  const brk = kids[b + 1] ?? kids[a - 1]; // the break after the line, or before it for the last line
  for (const n of kids.slice(a, b + 1)) n.remove();
  if (brk) brk.remove();
  const at2 = Math.min(a, top.getChildrenSize());
  top.select(at2, at2);
  return text;
}

const $childOf = (n: LexicalNode, parent: LexicalNode): LexicalNode => {
  let cur: LexicalNode = n;
  while (cur.getParent() && cur.getParent() !== parent) cur = cur.getParent()!;
  return cur;
};

function $removeBlock(top: LexicalNode & { getTextContent(): string }): string {
  const text = top.getTextContent();
  const sib = top.getPreviousSibling() ?? top.getNextSibling();
  top.remove();
  const root = $getRoot();
  if (root.getChildrenSize() === 0) {
    const p = $createParagraphNode();
    root.append(p);
    p.selectStart();
  } else if (sib && $isElementNode(sib)) sib.selectEnd();
  return text;
}

/** An empty paragraph beside a table, collapsible section or code block goes, and the caret moves into that block.
 *  `back` is Backspace (the block before it), else Delete (the block after it). False when it does not apply. */
export function $dropEmptyParagraph(back: boolean): boolean {
  const sel = $getSelection();
  if (!$isRangeSelection(sel) || !sel.isCollapsed()) return false;
  const p = sel.anchor.getNode();
  if (!$isParagraphNode(p) || p.getChildrenSize() !== 0 || p.getParent() !== $getRoot()) return false;
  const other = back ? p.getPreviousSibling() : p.getNextSibling();
  if (!other || !($isTableNode(other) || $isDetailsNode(other) || $isCodeNode(other))) return false;
  p.remove();
  if ($isElementNode(other)) back ? other.selectEnd() : other.selectStart();
  return true;
}

/** Registers the three keys on a rich editor; returns the function that takes them off. */
export function registerRichKeys(editor: LexicalEditor): () => void {
  return mergeRegister(
    editor.registerCommand(
      CUT_COMMAND,
      (event) => {
        const text = $cutAtCaret(); // a command runs inside an editor update already
        if (text === null) return false;
        event?.preventDefault();
        if (event && "clipboardData" in event && event.clipboardData) event.clipboardData.setData("text/plain", text);
        else void navigator.clipboard?.writeText(text).catch(() => undefined);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(KEY_BACKSPACE_COMMAND, (e) => ($dropEmptyParagraph(true) ? (e.preventDefault(), true) : false), COMMAND_PRIORITY_HIGH),
    editor.registerCommand(KEY_DELETE_COMMAND, (e) => ($dropEmptyParagraph(false) ? (e.preventDefault(), true) : false), COMMAND_PRIORITY_HIGH),
    editor.registerCommand(
      KEY_MODIFIER_COMMAND,
      (e) => {
        if (e.key.toLowerCase() !== "k" || e.shiftKey || e.altKey || !(e.ctrlKey || e.metaKey)) return false;
        e.preventDefault();
        document.dispatchEvent(new CustomEvent(LINK_EVENT, { detail: editor.getRootElement() }));
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),
  );
}
