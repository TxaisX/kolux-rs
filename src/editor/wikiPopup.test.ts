import { describe, expect, it } from "vitest";
import { $createParagraphNode, $createTextNode, $getRoot, createEditor, KEY_ARROW_DOWN_COMMAND, KEY_ENTER_COMMAND, KEY_ESCAPE_COMMAND, type LexicalCommand, type LexicalEditor } from "lexical";
import { LinkNode } from "@lexical/link";
import { $convertToMarkdownString, TRANSFORMERS } from "@lexical/markdown";
import { createWiki, insertWikiLink, relativeLink, wikiItems, wikiQuery, type WikiView } from "./wikiPopup";

// EDIT-014 (T-234-b): the [[ popup: when it opens, how it narrows, how a pick becomes a relative link.
const FILES = ["README.md", "docs/Setup guide.md", "docs/api/index.md", "notes/index.md", "notes/ideas.md", "src/main.ts"];

function rig(text: string, notePath = "docs/plan.md") {
  const ed = createEditor({ namespace: "w", nodes: [LinkNode], onError: (e) => { throw e; } });
  const shown: (WikiView | null)[] = [];
  const wiki = createWiki(ed, () => FILES, notePath, (v) => shown.push(v));
  ed.update(
    () => {
      const p = $createParagraphNode();
      p.append($createTextNode(text));
      $getRoot().clear().append(p);
      p.selectEnd();
    },
    { discrete: true },
  );
  return { ed, wiki, shown };
}
const last = (shown: (WikiView | null)[]) => shown[shown.length - 1];
const md = (ed: LexicalEditor) => ed.getEditorState().read(() => $convertToMarkdownString(TRANSFORMERS));
const press = (ed: LexicalEditor, cmd: LexicalCommand<KeyboardEvent> | LexicalCommand<KeyboardEvent | null>) => {
  let handled = false;
  ed.update(() => void (handled = ed.dispatchCommand(cmd as LexicalCommand<KeyboardEvent>, { shiftKey: false, preventDefault: () => undefined } as unknown as KeyboardEvent)), { discrete: true });
  ed.update(() => undefined, { discrete: true });
  return handled;
};

describe("when the popup opens", () => {
  it("follows two opening brackets on the same line and nothing else", () => {
    expect(wikiQuery("see [[")).toBe("");
    expect(wikiQuery("see [[set")).toBe("set");
    expect(wikiQuery("see [set")).toBeNull();
    expect(wikiQuery("[[done]] and more")).toBeNull();
    expect(wikiQuery("[[a|b")).toBeNull();
    expect(wikiQuery("[[two\nlines")).toBeNull(); // a link never spans a line break
  });
});

describe("the list", () => {
  it("narrows by name and flags a name that fits more than one file", () => {
    const all = wikiItems(FILES, "");
    expect(all.map((i) => i.path)).not.toContain("src/main.ts"); // notes only
    const idx = wikiItems(FILES, "ind");
    expect(idx.map((i) => i.path)).toEqual(["docs/api/index.md", "notes/index.md"]);
    expect(idx.every((i) => i.same === 2)).toBe(true);
    expect(wikiItems(FILES, "setup")[0]).toMatchObject({ path: "docs/Setup guide.md", same: 1 });
    expect(wikiItems(FILES, "zzz")).toEqual([]);
  });
});

describe("the link a pick makes", () => {
  it("is relative to the note, with spaces as %20", () => {
    expect(relativeLink("docs/plan.md", "docs/Setup guide.md")).toBe("Setup%20guide.md");
    expect(relativeLink("docs/plan.md", "README.md")).toBe("../README.md");
    expect(relativeLink("docs/plan.md", "notes/ideas.md")).toBe("../notes/ideas.md");
    expect(relativeLink("README.md", "docs/api/index.md")).toBe("docs/api/index.md");
    expect(relativeLink("docs\\a\\b.md", "docs\\c.md")).toBe("../c.md");
  });

  it("replaces the typed brackets and word with a link named after the note", () => {
    const { ed } = rig("see [[setu");
    expect(insertWikiLink(ed, "docs/plan.md", "docs/Setup guide.md")).toBe(true);
    expect(md(ed)).toBe("see [Setup guide](Setup%20guide.md)");
  });

  it("does nothing when the caret is not after brackets", () => {
    const { ed } = rig("plain text");
    expect(insertWikiLink(ed, "a.md", "b.md")).toBe(false);
    expect(md(ed)).toBe("plain text");
  });
});

describe("keys", () => {
  it("opens, arrows move, Enter picks the highlighted note; Escape closes and Enter is the editor's again", () => {
    const { ed, shown } = rig("go [[ind");
    expect(last(shown)?.items.map((i) => i.path)).toEqual(["docs/api/index.md", "notes/index.md"]);
    expect(press(ed, KEY_ARROW_DOWN_COMMAND)).toBe(true);
    expect(last(shown)?.index).toBe(1);
    expect(press(ed, KEY_ENTER_COMMAND)).toBe(true);
    expect(md(ed)).toBe("go [index](../notes/index.md)");
    expect(last(shown)).toBeNull();
    const b = rig("[[ide");
    expect(press(b.ed, KEY_ESCAPE_COMMAND)).toBe(true);
    expect(last(b.shown)).toBeNull();
    expect(press(b.ed, KEY_ENTER_COMMAND)).toBe(false);
  });
});
