import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { replaceShown, seedFor, setReplace } from "./find";

const at = (doc: string, from: number, to = from) => EditorState.create({ doc, selection: EditorSelection.single(from, to), extensions: [replaceShown] });

describe("EDIT-005 find seed", () => {
  it("takes the selection when the user selected text", () => {
    expect(seedFor(at("let total = sum(rows);", 4, 9), "old")).toBe("total");
  });

  it("never takes the word at the caret: with nothing selected the box keeps the previous search", () => {
    // The caret sits inside "total"; a word-at-caret seed would give "total".
    expect(seedFor(at("let total = sum(rows);", 6), "rows")).toBe("rows");
  });

  it("keeps the previous search for a selection spanning lines or a very long one", () => {
    expect(seedFor(at("one\ntwo", 0, 7), "prev")).toBe("prev");
    expect(seedFor(at("x".repeat(300), 0, 200), "prev")).toBe("prev");
  });
});

describe("EDIT-005 replace form", () => {
  it("is hidden until the replace shortcut asks for it, and find hides it again", () => {
    let s = at("abc", 0);
    expect(s.field(replaceShown)).toBe(false);
    s = s.update({ effects: setReplace.of(true) }).state;
    expect(s.field(replaceShown)).toBe(true);
    s = s.update({ effects: setReplace.of(false) }).state;
    expect(s.field(replaceShown)).toBe(false);
  });
});
