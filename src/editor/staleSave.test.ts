import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { attach, detach, hashOf, isDirty, type View } from "./buffers";

// EDIT-003 (T-073-c): the save that editor tabs and unstaged diff tabs share. The write carries
// the hash of the text the tab loaded, and a stale refusal opens the Reload / Keep mine choice
// instead of a toast.
const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
const { saveFile } = await import("./EditorPane");

function view(doc: string): View {
  const v: View = {
    state: EditorState.create({ doc }),
    dispatch: (spec) => {
      v.state = v.state.update({ changes: spec.changes }).state;
    },
  };
  return v;
}

describe("saveFile (EDIT-003, T-073-c)", () => {
  const p = "C:/w/diff-stale.ts";
  let v: View | null = null;
  afterEach(() => {
    if (v) detach(p, v);
    v = null;
    invoke.mockReset();
  });

  it("sends the hash of the loaded disk copy, so a moved file is refused", async () => {
    v = view("one\n");
    attach(p, v, "one\n");
    v.dispatch({ changes: { from: 0, to: 3, insert: "mine" }, annotations: undefined as never });
    invoke.mockResolvedValue(undefined);
    const stale = vi.fn();
    await saveFile(p, stale);
    expect(invoke).toHaveBeenCalledWith("file_write", { path: p, text: "mine\n", loadedHash: await hashOf("one\n") });
    expect(stale).toHaveBeenCalledWith(false);
    expect(isDirty(p)).toBe(false);
  });

  it("turns a stale refusal into the choice, not a toast, and keeps the edit unsaved", async () => {
    v = view("one\n");
    attach(p, v, "one\n");
    v.dispatch({ changes: { from: 0, to: 3, insert: "mine" }, annotations: undefined as never });
    invoke.mockRejectedValue({ kind: "stale", message: "changed on disk" });
    const stale = vi.fn();
    const toast = vi.fn();
    await saveFile(p, stale, toast);
    expect(stale).toHaveBeenCalledWith(true);
    expect(toast).not.toHaveBeenCalled();
    expect(isDirty(p)).toBe(true);
  });

  it("toasts any other failure", async () => {
    v = view("one\n");
    attach(p, v, "one\n");
    invoke.mockRejectedValue("disk full");
    const stale = vi.fn();
    const toast = vi.fn();
    await saveFile(p, stale, toast);
    expect(stale).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("diff-stale.ts was not saved: disk full");
  });
});
