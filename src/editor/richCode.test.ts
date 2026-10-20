import { describe, expect, it } from "vitest";
import { $getRoot, createEditor, type LexicalEditor } from "lexical";
import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { $convertFromMarkdownString, $convertToMarkdownString, TRANSFORMERS } from "@lexical/markdown";
import { canonLanguage, codeBlocks, languageChoices, languageName, setCodeLanguage, unknownLanguage } from "./richCode";

// EDIT-010 (T-234-b): the language label of a code block and the plain-text choice.
const mk = (md: string): LexicalEditor => {
  const ed = createEditor({ namespace: "c", nodes: [CodeNode, CodeHighlightNode], onError: (e) => { throw e; } });
  ed.update(() => $convertFromMarkdownString(md, TRANSFORMERS), { discrete: true });
  return ed;
};
const out = (ed: LexicalEditor) => ed.getEditorState().read(() => $convertToMarkdownString(TRANSFORMERS));
const first = (ed: LexicalEditor) => ed.getEditorState().read(() => ($getRoot().getFirstChild() as { getKey(): string }).getKey());

describe("language names", () => {
  it("resolves short spellings and case", () => {
    expect(canonLanguage("TS")).toBe("typescript");
    expect(canonLanguage("ps1")).toBe("powershell");
    expect(canonLanguage("plaintext")).toBe("");
    expect(canonLanguage(null)).toBe("");
    expect(languageName("js")).toBe("JavaScript");
    expect(languageName("")).toBe("Plain text");
  });

  it("flags a language the list does not know and keeps it as the first choice", () => {
    expect(unknownLanguage("brainfuck")).toBe(true);
    expect(unknownLanguage("rust")).toBe(false);
    expect(languageName("brainfuck")).toBe("brainfuck (not recognised)");
    const c = languageChoices("brainfuck");
    expect(c[0]).toEqual({ id: "brainfuck", name: "brainfuck (not recognised)" });
    expect(c.some((x) => x.id === "" && x.name === "Plain text")).toBe(true);
    expect(languageChoices("rust")[0].id).toBe("");
  });
});

describe("changing the label", () => {
  it("writes the new language into the fence, and plain text writes none", () => {
    const ed = mk("```brainfuck\n+++\n```");
    expect(codeBlocks(ed).map((b) => b.language)).toEqual(["brainfuck"]);
    expect(setCodeLanguage(ed, first(ed), "")).toBe(true);
    expect(out(ed)).toBe("```\n+++\n```");
    setCodeLanguage(ed, first(ed), "rs");
    expect(out(ed)).toBe("```rust\n+++\n```");
  });

  it("keeps an unknown language as typed when it is chosen again, and refuses a key that is not a code block", () => {
    const ed = mk("```zig\nx\n```");
    expect(setCodeLanguage(ed, first(ed), "zig")).toBe(true);
    expect(out(ed)).toBe("```zig\nx\n```");
    expect(setCodeLanguage(ed, "nope", "rust")).toBe(false);
  });
});
