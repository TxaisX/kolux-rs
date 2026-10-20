// EDIT-057 (T-237-b): the formatting toolbar above a note in rich view. Each button names one action;
// applyFormat runs it on the rich editor's current selection. Heading, quote and list buttons toggle:
// a second press on the same block turns it back into body text. Link, image and the collapsible
// section need a picker or a block the rich view does not have yet, so they are not offered.
import { $createParagraphNode, $getSelection, $isElementNode, $isRangeSelection, COMMAND_PRIORITY_NORMAL, FORMAT_TEXT_COMMAND, INDENT_CONTENT_COMMAND, KEY_TAB_COMMAND, OUTDENT_CONTENT_COMMAND, type ElementNode, type LexicalEditor } from "lexical";
import { $createHeadingNode, $createQuoteNode, $isHeadingNode, $isQuoteNode, type HeadingTagType } from "@lexical/rich-text";
import { $isListItemNode, $isListNode, INSERT_CHECK_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, REMOVE_LIST_COMMAND } from "@lexical/list";

export type RichAction = "body" | "h1" | "h2" | "h3" | "h4" | "h5" | "bold" | "italic" | "strike" | "bullet" | "numbered" | "check" | "quote";

/** The toolbar's buttons in order; `label` is what the button shows, `tip` the tooltip. */
export const RICH_BUTTONS: { id: RichAction; label: string; tip: string }[] = [
  { id: "body", label: "T", tip: "Body text" },
  { id: "h1", label: "H1", tip: "Heading 1" },
  { id: "h2", label: "H2", tip: "Heading 2" },
  { id: "h3", label: "H3", tip: "Heading 3" },
  { id: "bold", label: "B", tip: "Bold" },
  { id: "italic", label: "I", tip: "Italic" },
  { id: "strike", label: "S", tip: "Strikethrough" },
  { id: "bullet", label: "•", tip: "Bullet list" },
  { id: "numbered", label: "1.", tip: "Numbered list" },
  { id: "check", label: "☑", tip: "Checklist" },
  { id: "quote", label: "“", tip: "Quote" },
];

/** The More blocks menu. */
export const MORE_BLOCKS: { id: RichAction; tip: string }[] = [
  { id: "h4", tip: "Heading 4" },
  { id: "h5", tip: "Heading 5" },
];

const LIST_COMMAND = { bullet: INSERT_UNORDERED_LIST_COMMAND, numbered: INSERT_ORDERED_LIST_COMMAND, check: INSERT_CHECK_LIST_COMMAND } as const;
const LIST_TYPE = { bullet: "bullet", numbered: "number", check: "check" } as const;

/** The top-level blocks the selection touches, each once. */
function $blocks(): ElementNode[] {
  const sel = $getSelection();
  if (!$isRangeSelection(sel)) return [];
  const seen = new Map<string, ElementNode>();
  for (const n of sel.getNodes()) {
    const top = n.getTopLevelElement();
    if ($isElementNode(top)) seen.set(top.getKey(), top);
  }
  return [...seen.values()];
}

/** Turns every selected block that is not a list into `make()`, or into body text when they all
 * already are that kind (the toggle). */
function $turn(is: (b: ElementNode) => boolean, make: () => ElementNode) {
  const blocks = $blocks().filter((b) => !$isListNode(b));
  const off = blocks.length > 0 && blocks.every(is);
  for (const b of blocks) b.replace(off ? $createParagraphNode() : make(), true);
}

/** Runs one toolbar action on the editor's selection. Returns false for an action it does not know. */
export function applyFormat(editor: LexicalEditor, action: RichAction): boolean {
  switch (action) {
    case "bold":
      return editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold");
    case "italic":
      return editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic");
    case "strike":
      return editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough");
    case "bullet":
    case "numbered":
    case "check": {
      let same = false;
      editor.getEditorState().read(() => {
        const blocks = $blocks();
        same = blocks.length > 0 && blocks.every((b) => $isListNode(b) && b.getListType() === LIST_TYPE[action]);
      });
      return editor.dispatchCommand(same ? REMOVE_LIST_COMMAND : LIST_COMMAND[action], undefined);
    }
    case "quote":
      editor.update(() => $turn($isQuoteNode, $createQuoteNode), { discrete: true });
      return true;
    case "body":
      editor.update(
        () => {
          for (const b of $blocks()) if ($isHeadingNode(b) || $isQuoteNode(b)) b.replace($createParagraphNode(), true);
        },
        { discrete: true },
      );
      return true;
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5": {
      const tag = action as HeadingTagType;
      editor.update(() => $turn((b) => $isHeadingNode(b) && b.getTag() === tag, () => $createHeadingNode(tag)), { discrete: true });
      return true;
    }
  }
}

/** Tab inside a list item indents it one level and Shift+Tab brings it back (the rich-text handler
 *  alone leaves lists untouched). Outside a list the key passes through. */
export function registerListKeys(editor: LexicalEditor): () => void {
  return editor.registerCommand(
    KEY_TAB_COMMAND,
    (e) => {
      const sel = $getSelection();
      if (!$isRangeSelection(sel)) return false;
      if (!sel.anchor.getNode().getParents().some($isListItemNode) && !$isListItemNode(sel.anchor.getNode())) return false;
      e.preventDefault();
      return editor.dispatchCommand(e.shiftKey ? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND, undefined);
    },
    COMMAND_PRIORITY_NORMAL,
  );
}
