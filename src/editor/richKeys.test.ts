import { afterEach, describe, expect, it, vi } from "vitest";
import { $createLineBreakNode, $createParagraphNode, $createTextNode, $getRoot, createEditor, CUT_COMMAND, KEY_BACKSPACE_COMMAND, KEY_MODIFIER_COMMAND, type LexicalEditor } from "lexical";
import { ListItemNode, ListNode, registerList } from "@lexical/list";
import { HeadingNode, QuoteNode, registerRichText } from "@lexical/rich-text";
import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { $convertFromMarkdownString, $convertToMarkdownString, TRANSFORMERS, type Transformer } from "@lexical/markdown";
import { $cutAtCaret, $dropEmptyParagraph, LINK_EVENT, registerRichKeys } from "./richKeys";
import { DETAILS_NODES, makeDetails } from "./richDetails";
import { registerTable, TABLE, TABLE_NODES } from "./richTable";

// EDIT-010 (T-234-b): cut with nothing selected, clean removal of an empty paragraph, Mod+K.
const MD: Transformer[] = [makeDetails(() => MD), TABLE, ...TRANSFORMERS];
function rig(md = "") {
  const ed = createEditor({ namespace: "k", nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, CodeHighlightNode, ...TABLE_NODES, ...DETAILS_NODES], onError: (e) => { throw e; } });
  registerRichText(ed);
  registerList(ed);
  registerTable(ed);
  registerRichKeys(ed);
  if (md) ed.update(() => $convertFromMarkdownString(md, MD), { discrete: true });
  return ed;
}
const md = (ed: LexicalEditor) => ed.getEditorState().read(() => $convertToMarkdownString(MD));
const flush = (ed: LexicalEditor) => ed.update(() => undefined, { discrete: true });
const cut = (ed: LexicalEditor) => {
  const data: Record<string, string> = {};
  let prevented = false;
  const event = { clipboardData: { setData: (k: string, v: string) => (data[k] = v) }, preventDefault: () => (prevented = true) } as unknown as ClipboardEvent;
  let handled = false;
  ed.update(() => void (handled = ed.dispatchCommand(CUT_COMMAND, event)), { discrete: true });
  flush(ed);
  return { handled, prevented, text: data["text/plain"] };
};
/** Puts the caret at the end of the nth text node of the document (document order). */
const caretIn = (ed: LexicalEditor, find: string) =>
  ed.update(
    () => {
      const hit = $getRoot().getAllTextNodes().find((t) => t.getTextContent().includes(find));
      if (!hit) throw new Error("no text " + find);
      hit.select(1, 1);
    },
    { discrete: true },
  );

describe("cut with nothing selected", () => {
  it("takes the whole paragraph at the caret", () => {
    const ed = rig("first\n\nsecond\n\nthird");
    caretIn(ed, "second");
    const r = cut(ed);
    expect(r).toEqual({ handled: true, prevented: true, text: "second" });
    expect(md(ed)).toBe("first\n\nthird");
  });

  it("takes a list item together with its sub-list", () => {
    const ed = rig("- one\n- two\n  - nested\n- three");
    caretIn(ed, "two");
    const r = cut(ed);
    expect(r.handled).toBe(true);
    expect(r.text).toContain("two");
    expect(r.text).toContain("nested");
    expect(md(ed)).toBe("- one\n- three");
  });

  it("takes one visual line of a hard-wrapped paragraph", () => {
    const ed = rig();
    ed.update(
      () => {
        const p = $createParagraphNode();
        p.append($createTextNode("line one"), $createLineBreakNode(), $createTextNode("line two"), $createLineBreakNode(), $createTextNode("line three"));
        $getRoot().clear().append(p);
      },
      { discrete: true },
    );
    caretIn(ed, "line two");
    expect(cut(ed).text).toBe("line two");
    expect(ed.getEditorState().read(() => $getRoot().getTextContent())).toBe("line one\nline three");
    caretIn(ed, "line three");
    expect(cut(ed).text).toBe("line three");
    expect(ed.getEditorState().read(() => $getRoot().getTextContent())).toBe("line one");
  });

  it("leaves a selection, a table and a code block to the normal cut", () => {
    const at = (ed: LexicalEditor) => {
      let r: string | null = "x";
      ed.update(() => void (r = $cutAtCaret()), { discrete: true });
      return r;
    };
    const ed = rig("```ts\nlet x\n```");
    caretIn(ed, "let x");
    expect(at(ed)).toBeNull();
    const t = rig("| a | b |\n| --- | --- |\n| 1 | 2 |");
    caretIn(t, "1");
    expect(at(t)).toBeNull();
    const s = rig("hello world");
    s.update(() => $getRoot().getAllTextNodes()[0].select(0, 5), { discrete: true });
    expect(at(s)).toBeNull();
    expect(md(s)).toBe("hello world");
  });

  it("cutting the only paragraph leaves an empty one", () => {
    const ed = rig("alone");
    caretIn(ed, "alone");
    expect(cut(ed).text).toBe("alone");
    expect(ed.getEditorState().read(() => $getRoot().getChildrenSize())).toBe(1);
  });
});

describe("empty paragraphs", () => {
  it("Backspace in an empty paragraph under a table removes it and puts the caret in the table", () => {
    const ed = rig("| a | b |\n| --- | --- |\n| 1 | 2 |");
    ed.update(() => { const p = $createParagraphNode(); $getRoot().append(p); p.select(); }, { discrete: true });
    let prevented = false;
    ed.update(() => void ed.dispatchCommand(KEY_BACKSPACE_COMMAND, { preventDefault: () => (prevented = true) } as unknown as KeyboardEvent), { discrete: true });
    flush(ed);
    expect(prevented).toBe(true);
    expect(ed.getEditorState().read(() => $getRoot().getChildrenSize())).toBe(1);
    expect(md(ed)).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |");
  });

  it("does nothing special between ordinary paragraphs", () => {
    const ed = rig("one");
    ed.update(() => { const p = $createParagraphNode(); $getRoot().append(p); p.select(); }, { discrete: true });
    let r = true;
    ed.update(() => void (r = $dropEmptyParagraph(true)), { discrete: true });
    expect(r).toBe(false);
    expect(ed.getEditorState().read(() => $getRoot().getChildrenSize())).toBe(2);
  });
});

describe("the link shortcut", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("Ctrl+K asks the toolbar for its Link box; other keys pass", () => {
    const doc = new EventTarget();
    vi.stubGlobal("document", doc);
    const ed = rig("x");
    let fired = 0;
    doc.addEventListener(LINK_EVENT, () => fired++);
    let prevented = false;
    const key = (k: string) => ({ key: k, ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, preventDefault: () => (prevented = true) }) as unknown as KeyboardEvent;
    ed.update(() => void ed.dispatchCommand(KEY_MODIFIER_COMMAND, key("k")), { discrete: true });
    expect(prevented).toBe(true);
    expect(fired).toBe(1);
    prevented = false;
    ed.update(() => void ed.dispatchCommand(KEY_MODIFIER_COMMAND, key("j")), { discrete: true });
    expect(fired).toBe(1);
  });
});
