import { describe, expect, it } from "vitest";
import { $createParagraphNode, $createTextNode, $getRoot, createEditor, KEY_ARROW_DOWN_COMMAND, KEY_ENTER_COMMAND, KEY_ESCAPE_COMMAND, KEY_TAB_COMMAND, type LexicalCommand, type LexicalEditor } from "lexical";
import { HeadingNode, QuoteNode, registerRichText } from "@lexical/rich-text";
import { ListItemNode, ListNode, registerCheckList, registerList } from "@lexical/list";
import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { $convertFromMarkdownString, $convertToMarkdownString, CHECK_LIST, TRANSFORMERS } from "@lexical/markdown";
import { createSlash, matchSlash, runSlash, SLASH_ENTRIES, slashQuery, type SlashView } from "./slashMenu";
import { registerTable, TABLE, TABLE_NODES } from "./richTable";
import { registerListKeys } from "./richFormat";

// EDIT-010 (T-234-b): the slash menu's matching and what each entry inserts, plus the list keys the
// card asks for (Tab indents, Enter continues, Enter on an empty item ends the list).
const MD = [TABLE, CHECK_LIST, ...TRANSFORMERS];
function rig(md = "") {
  const ed = createEditor({ namespace: "s", nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, CodeHighlightNode, ...TABLE_NODES], onError: (e) => { throw e; } });
  registerRichText(ed);
  registerList(ed);
  registerCheckList(ed);
  registerTable(ed);
  registerListKeys(ed);
  const shown: (SlashView | null)[] = [];
  const slash = createSlash(ed, (v) => shown.push(v));
  if (md) ed.update(() => $convertFromMarkdownString(md, MD), { discrete: true });
  return { ed, slash, shown };
}
/** A paragraph holding `text` with the caret at its end. */
const typed = (ed: LexicalEditor, text: string) =>
  ed.update(
    () => {
      const p = $createParagraphNode();
      p.append($createTextNode(text));
      $getRoot().clear().append(p);
      p.selectEnd();
    },
    { discrete: true },
  );
const md = (ed: LexicalEditor) => ed.getEditorState().read(() => $convertToMarkdownString(MD));
/** Commands run in a normal update, which commits a moment later: an empty discrete update flushes it. */
const flush = (ed: LexicalEditor) => ed.update(() => undefined, { discrete: true });
const press = (ed: LexicalEditor, cmd: LexicalCommand<KeyboardEvent> | LexicalCommand<KeyboardEvent | null>, shiftKey = false) => {
  let handled = false;
  ed.update(() => void (handled = ed.dispatchCommand(cmd as LexicalCommand<KeyboardEvent>, { shiftKey, preventDefault: () => undefined } as unknown as KeyboardEvent)), { discrete: true });
  flush(ed);
  return handled;
};

describe("finding entries", () => {
  it("opens for a slash at the start of a line or after a space, never inside a word or a path", () => {
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("/hea")).toBe("hea");
    expect(slashQuery("see /tab")).toBe("tab");
    expect(slashQuery("a/b")).toBeNull();
    expect(slashQuery("https://x.y/z")).toBeNull();
    expect(slashQuery("/two words")).toBeNull();
  });

  it("narrows as you type and also answers to each entry's other names", () => {
    expect(matchSlash("")).toHaveLength(SLASH_ENTRIES.length);
    expect(matchSlash("head").map((e) => e.id)).toEqual(["h1", "h2", "h3"]);
    expect(matchSlash("h2").map((e) => e.id)[0]).toBe("h2");
    expect(matchSlash("todo")[0].id).toBe("check"); // another name of Task list
    expect(matchSlash("latex")[0].id).toBe("math");
    expect(matchSlash("flowchart")[0].id).toBe("mermaid");
    expect(matchSlash("smile")[0].label).toContain("smile");
    expect(matchSlash("zzzz")).toEqual([]);
    expect(matchSlash("TABLE")[0].id).toBe("table");
  });

  it("covers headings, tables, diagrams, maths and emoji", () => {
    const ids = SLASH_ENTRIES.map((e) => e.id);
    for (const want of ["h1", "table", "mermaid", "math", "check", "code"]) expect(ids).toContain(want);
    expect(ids.some((i) => i.startsWith("emoji:"))).toBe(true);
  });
});

describe("inserting", () => {
  it("a heading replaces the typed slash word and turns the line into a heading", () => {
    const { ed } = rig();
    typed(ed, "/h2");
    runSlash(ed, "h2");
    flush(ed);
    expect(md(ed)).toBe("## ");
  });

  it("a table goes after the text the slash followed, a diagram becomes a mermaid fence, maths two dollar lines", () => {
    const { ed } = rig();
    typed(ed, "intro /table");
    runSlash(ed, "table");
    expect(md(ed)).toBe("intro\n\n|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |");
    typed(ed, "/diagram");
    runSlash(ed, "mermaid");
    expect(md(ed)).toBe("```mermaid\n```");
    typed(ed, "/math");
    runSlash(ed, "math");
    expect(md(ed)).toBe("$$\n\n$$");
  });

  it("lists and emoji", () => {
    const { ed } = rig();
    typed(ed, "/todo");
    runSlash(ed, "check");
    flush(ed);
    expect(md(ed)).toBe("- [ ] ");
    typed(ed, "go /rocket");
    runSlash(ed, "emoji:\u{1F680}");
    expect(md(ed)).toBe("go \u{1F680}");
    expect(runSlash(ed, "nope")).toBe(false);
  });
});

describe("the open menu", () => {
  it("opens while a slash word is at the caret, moves with the arrows, picks with Enter and closes on Escape", () => {
    const { ed, shown, slash } = rig();
    typed(ed, "/head");
    expect(slash.view()?.items.map((e) => e.id)).toEqual(["h1", "h2", "h3"]);
    expect(press(ed, KEY_ARROW_DOWN_COMMAND)).toBe(true);
    expect(slash.view()?.index).toBe(1);
    expect(press(ed, KEY_ENTER_COMMAND)).toBe(true);
    expect(md(ed)).toBe("## ");
    expect(slash.view()).toBeNull();
    expect(shown[shown.length - 1]).toBeNull();
    typed(ed, "/tab");
    expect(press(ed, KEY_ESCAPE_COMMAND)).toBe(true);
    expect(slash.view()).toBeNull();
    expect(md(ed)).toBe("/tab"); // Escape leaves the typed text alone
    typed(ed, "/tabl");
    expect(slash.view()?.query).toBe("tabl"); // more typing opens it again
    expect(press(ed, KEY_TAB_COMMAND)).toBe(true);
    expect(md(ed)).toContain("| --- |");
  });

  it("keys pass through when the menu is closed, and no match closes it", () => {
    const { ed, slash } = rig();
    typed(ed, "plain");
    expect(press(ed, KEY_ARROW_DOWN_COMMAND)).toBe(false);
    typed(ed, "/qqqq");
    expect(slash.view()).toBeNull();
  });
});

describe("lists in the rich view", () => {
  it("Enter continues a list, Enter in an empty item ends it, Tab indents and Shift+Tab outdents", () => {
    const { ed } = rig("- one\n- two");
    ed.update(() => $getRoot().getLastDescendant()!.selectEnd(), { discrete: true });
    press(ed, KEY_ENTER_COMMAND);
    expect(md(ed)).toBe("- one\n- two\n- ");
    press(ed, KEY_TAB_COMMAND);
    expect(md(ed)).toBe("- one\n- two\n    - ");
    press(ed, KEY_TAB_COMMAND, true);
    expect(md(ed)).toBe("- one\n- two\n- ");
    press(ed, KEY_ENTER_COMMAND);
    expect(md(ed)).toBe("- one\n- two\n"); // the ended list leaves an empty line below it
  });
});
