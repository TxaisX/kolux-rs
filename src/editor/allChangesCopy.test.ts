import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { allChangesContext } from "./allChangesCopy";

const view = (text: string, from: number, to: number) => ({ state: EditorState.create({ doc: text, selection: { anchor: from, head: to } }) });

describe("EDIT-007 in All Changes: Copy Context", () => {
  it("copies the new side's lines under the file's path inside the worktree", () => {
    const v = view("one\ntwo\nthree\n", 0, 7);
    expect(allChangesContext({ path: "C:/r/src/a.ts", old: false, view: v }, "C:/r")).toBe("src/a.ts:1-2\none\ntwo");
  });
  it("marks lines copied from the old side as before the change", () => {
    const v = view("one\ntwo\nthree\n", 4, 13);
    expect(allChangesContext({ path: "C:/r/a.ts", old: true, view: v }, "C:/r")).toBe("a.ts:2-3 (before the change)\ntwo\nthree");
  });
  it("names the line when nothing is selected, and part of one line is bare text", () => {
    expect(allChangesContext({ path: "C:/r/a.ts", old: false, view: view("one\ntwo\n", 5, 5) }, "C:/r")).toBe("a.ts:2");
    expect(allChangesContext({ path: "C:/r/a.ts", old: false, view: view("one\ntwo\n", 1, 3) }, "C:/r")).toBe("ne");
  });
  it("copies nothing before a diff view was focused, so the chord passes through", () => {
    expect(allChangesContext(null, "C:/r")).toBeNull();
  });
});
