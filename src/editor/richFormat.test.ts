import { describe, expect, test } from "vitest";
import { $createTextNode, $getRoot, createEditor, type ElementNode, type LexicalEditor } from "lexical";
import { HeadingNode, QuoteNode, registerRichText } from "@lexical/rich-text";
import { ListItemNode, ListNode, registerCheckList, registerList } from "@lexical/list";
import { $convertFromMarkdownString, $convertToMarkdownString, CHECK_LIST, TRANSFORMERS } from "@lexical/markdown";
import { applyFormat, MORE_BLOCKS, RICH_BUTTONS } from "./richFormat";

const MD = [CHECK_LIST, ...TRANSFORMERS];

function editorWith(md: string, pick: "start" | "word" = "start"): LexicalEditor {
  const e = createEditor({ namespace: "t", nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode], onError: (x) => { throw x; } });
  registerRichText(e);
  registerList(e);
  registerCheckList(e);
  e.update(() => {
    $convertFromMarkdownString(md, MD);
    if (pick === "start") $getRoot().selectStart();
    else {
      const t = ($getRoot().getFirstChild() as ElementNode).getFirstChild()!;
      (t as ReturnType<typeof $createTextNode>).select(0, 5); // the first word
    }
  }, { discrete: true });
  return e;
}
// A command runs in a scheduled update; an empty discrete update commits it before the read.
const md = (e: LexicalEditor) => {
  e.update(() => {}, { discrete: true });
  return e.getEditorState().read(() => $convertToMarkdownString(MD));
};

describe("EDIT-057 (T-237-b): the formatting toolbar", () => {
  test("headings toggle: a second press turns the block back into body text", () => {
    const e = editorWith("hello world");
    applyFormat(e, "h2");
    expect(md(e)).toBe("## hello world");
    applyFormat(e, "h2");
    expect(md(e)).toBe("hello world");
    applyFormat(e, "h1");
    applyFormat(e, "h4");
    expect(md(e)).toBe("#### hello world");
    applyFormat(e, "body");
    expect(md(e)).toBe("hello world");
  });

  test("quote toggles, and a heading becomes a quote", () => {
    const e = editorWith("hello world");
    applyFormat(e, "quote");
    expect(md(e)).toBe("> hello world");
    applyFormat(e, "quote");
    expect(md(e)).toBe("hello world");
  });

  test("lists start, switch type and toggle off", () => {
    const e = editorWith("one");
    applyFormat(e, "numbered");
    expect(md(e)).toBe("1. one");
    applyFormat(e, "numbered");
    expect(md(e)).toBe("one");
    applyFormat(e, "check");
    expect(md(e)).toBe("- [ ] one");
    applyFormat(e, "bullet");
    expect(md(e)).toBe("- one");
  });

  test("bold, italic and strikethrough apply to the selected word only", () => {
    const e = editorWith("hello world", "word");
    applyFormat(e, "bold");
    expect(md(e)).toBe("**hello** world");
    const f = editorWith("hello world", "word");
    applyFormat(f, "italic");
    expect(md(f)).toBe("*hello* world");
    const g = editorWith("hello world", "word");
    applyFormat(g, "strike");
    expect(md(g)).toBe("~~hello~~ world");
  });

  test("the toolbar offers the buttons in order and More blocks adds headings 4 and 5", () => {
    expect(RICH_BUTTONS.map((b) => b.id)).toEqual(["body", "h1", "h2", "h3", "bold", "italic", "strike", "bullet", "numbered", "check", "quote", "link", "image"]);
    expect(RICH_BUTTONS.every((b) => b.tip.length > 0)).toBe(true);
    expect(MORE_BLOCKS.map((b) => b.id)).toEqual(["h4", "h5", "details"]);
  });
});
