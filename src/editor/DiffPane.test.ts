import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { Chunk } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { noteField, setNotes, withoutWhitespace, type NoteActions } from "./DiffPane";
import type { LineNote } from "./diffNotes";

const chunks = (a: string, b: string, override?: typeof withoutWhitespace) => Chunk.build(Text.of(a.split("\n")), Text.of(b.split("\n")), override && { override });

describe("diff tab whitespace (EDIT-027)", () => {
  const a = "one\n  two\nthree\nfour";
  const b = "one\ntwo   \nthree\nFOUR";
  it("shows whitespace-only changes when asked", () => {
    expect(chunks(a, b).length).toBe(2);
  });
  it("leaves them out by default, keeping real changes where they are", () => {
    const left = chunks(a, b, withoutWhitespace);
    expect(left.length).toBe(1);
    expect(Text.of(b.split("\n")).lineAt(left[0].fromB).number).toBe(4);
  });
});

describe("review notes on both sides of a side-by-side diff (GIT-040, T-034-b)", () => {
  const act: NoteActions = { add: () => {}, edit: () => {}, remove: () => {} };
  const note = (id: string, line: number, side?: "old"): LineNote => ({ id, path: "a.ts", line, text: id, staged: false, side });
  // a card per note that lands on a line the side's text has, and each side only takes its own
  const cards = (doc: string, side: "new" | "old", notes: LineNote[]) => {
    const field = noteField(act, side);
    const state = EditorState.create({ doc, extensions: [field] }).update({ effects: setNotes.of(notes) }).state;
    return state.field(field).deco.size;
  };
  const notes = [note("n2", 2), note("o2", 2, "old"), note("o3", 3, "old"), note("o9", 9, "old")];
  it("the new side draws the new notes and the old side the old ones, even on the same line", () => {
    expect(cards("one\ntwo\nthree", "new", notes)).toBe(1);
    expect(cards("one\ntwo\nthree", "old", notes)).toBe(2); // o9 is past the old text's last line, so no card
  });
  it("an added file has an empty old side, so it draws no old card", () => {
    expect(cards("", "old", [note("o1", 1, "old")])).toBe(0);
  });
  it("the cards are laid out again when a new read of the text arrives", () => {
    const field = noteField(act, "old");
    let state = EditorState.create({ doc: "one", extensions: [field] }).update({ effects: setNotes.of([note("o2", 2, "old")]) }).state;
    expect(state.field(field).deco.size).toBe(0);
    state = state.update({ changes: { from: 3, insert: "\ntwo" } }).state;
    expect(state.field(field).deco.size).toBe(1);
  });
});

describe("how a diff tab starts (SET-038, T-323-b)", () => {
  it("follows the Settings > General diff choices, and starts inline, unwrapped, whitespace hidden by default", async () => {
    const { diffStart } = await import("./DiffPane");
    const { readEditorPrefs } = await import("../settings/editorPrefs");
    expect(diffStart(readEditorPrefs({}))).toEqual({ split: false, wrap: false, spaces: false });
    expect(diffStart(readEditorPrefs({ diffView: "split", diffWordWrap: true, diffShowWhitespace: true }))).toEqual({ split: true, wrap: true, spaces: true });
    // the editor's own word wrap does not move the diff's
    expect(diffStart(readEditorPrefs({ editorWordWrap: false })).wrap).toBe(false);
  });
});
