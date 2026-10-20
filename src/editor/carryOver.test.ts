import { afterEach, describe, expect, it } from "vitest";
import { EditorState, type Transaction } from "@codemirror/state";
import { attach, detach, hashOf, heldOf, isDirty, opening, relay, save, textOf, type View } from "./buffers";
import { announceMoves, confirmed } from "./fileMoved";
import { copyPath, keepUnsaved, keptToast, type CopyIo } from "./unsavedCopy";

// After-list row 131 (DATA LOSS): unsaved text in a diff tab was lost on rename or move, and the
// carried text could surface later in another tab and be saved over a newer disk copy.
const open: [string, View][] = [];
function view(path: string, text: string): View & { type: (s: string) => void } {
  const v = {
    state: EditorState.create({ doc: text }),
    dispatch(spec: Parameters<View["dispatch"]>[0]) {
      const tr: Transaction = v.state.update(spec);
      v.state = tr.state;
      relay(path, v, tr);
    },
    type(s: string) {
      const tr = v.state.update({ changes: { from: v.state.doc.length, insert: s } });
      v.state = tr.state;
      relay(path, v, tr);
    },
  };
  return v;
}
/** Opens `path` the way EditorPane and DiffPane do: the opening decides the text and the base. */
function openAt(path: string, disk: string, held?: Parameters<typeof opening>[2]) {
  const o = opening(path, disk, held);
  const v = view(path, o.text);
  attach(path, v, o.base);
  open.push([path, v]);
  return { o, v };
}
const close = (path: string, v: View) => {
  detach(path, v);
  open.splice(open.findIndex(([, x]) => x === v), 1);
};
afterEach(() => open.splice(0).forEach(([p, v]) => detach(p, v)));

/** A disk that refuses a write whose loaded hash is not the hash of what it holds (file_write). */
function disk(files: Record<string, string>) {
  return {
    files,
    write: (path: string) => async (text: string, loadedHash?: string) => {
      if (loadedHash !== undefined && loadedHash !== (await hashOf(files[path] ?? ""))) throw { kind: "stale" };
      files[path] = text;
    },
  };
}

describe("row 131: unsaved text follows a rename or move", () => {
  it("a dirty diff tab's text reaches the tab at the new path, and its save lands there", async () => {
    const d = disk({ "C:/w/r131-b.md": "one\n" });
    const { v } = openAt("C:/w/r131-a.md", "one\n");
    v.type("two\n");
    announceMoves([["C:/w/r131-a.md", "C:/w/r131-b.md"]], null);
    close("C:/w/r131-a.md", v);
    const { o } = openAt("C:/w/r131-b.md", "one\n");
    expect(o).toEqual({ text: "one\ntwo\n", base: "one\n" });
    expect(isDirty("C:/w/r131-b.md")).toBe(true);
    await save("C:/w/r131-b.md", d.write("C:/w/r131-b.md"));
    expect(d.files["C:/w/r131-b.md"]).toBe("one\ntwo\n");
    confirmed("C:/w/r131-b.md");
  });

  it("the carry is taken once: a later tab on that path reads the disk, not the old text", () => {
    const { v } = openAt("C:/w/r131-c.md", "x\n");
    v.type("typed\n");
    announceMoves([["C:/w/r131-c.md", "C:/w/r131-d.md"]], null);
    close("C:/w/r131-c.md", v);
    const first = openAt("C:/w/r131-d.md", "x\n");
    close("C:/w/r131-d.md", first.v);
    expect(openAt("C:/w/r131-d.md", "newer\n").o).toEqual({ text: "newer\n", base: "newer\n" });
    confirmed("C:/w/r131-d.md");
  });

  it("carried text typed over a copy that changed on disk is never saved over the newer copy", async () => {
    const d = disk({ "C:/w/r131-f.md": "agent wrote this\n" });
    const { v } = openAt("C:/w/r131-e.md", "old\n");
    v.type("mine\n");
    announceMoves([["C:/w/r131-e.md", "C:/w/r131-f.md"]], null);
    close("C:/w/r131-e.md", v);
    const { o } = openAt("C:/w/r131-f.md", "agent wrote this\n");
    expect(o).toEqual({ text: "old\nmine\n", base: "old\n", keep: "old\nmine\n" });
    // Before the copy is written (or if it fails) the save is checked against the old copy: refused.
    await expect(save("C:/w/r131-f.md", d.write("C:/w/r131-f.md"))).rejects.toEqual({ kind: "stale" });
    expect(d.files["C:/w/r131-f.md"]).toBe("agent wrote this\n");
    confirmed("C:/w/r131-f.md");
  });

  it("a diff tab built again (layout switch) keeps its unsaved text and its old disk copy", async () => {
    const d = disk({ "C:/w/r131-g.md": "base\n" });
    const { v } = openAt("C:/w/r131-g.md", "base\n");
    v.type("edit\n");
    const held = heldOf("C:/w/r131-g.md");
    close("C:/w/r131-g.md", v);
    expect(textOf("C:/w/r131-g.md")).toBeNull();
    // Git's copy moved on meanwhile: the rebuilt tab still shows the edit and its save asks.
    const { o } = openAt("C:/w/r131-g.md", "changed\n", held);
    expect(o).toEqual({ text: "base\nedit\n", base: "base\n" });
    d.files["C:/w/r131-g.md"] = "changed\n";
    await expect(save("C:/w/r131-g.md", d.write("C:/w/r131-g.md"))).rejects.toEqual({ kind: "stale" });
  });

  it("a clean tab holds nothing, and held text never crosses to another path", () => {
    const { v } = openAt("C:/w/r131-h.md", "same\n");
    expect(heldOf("C:/w/r131-h.md")).toBeNull();
    v.type("x");
    const held = heldOf("C:/w/r131-h.md");
    close("C:/w/r131-h.md", v);
    expect(openAt("C:/w/r131-i.md", "other\n", held).o).toEqual({ text: "other\n", base: "other\n" });
  });
});

describe("row 131: the copy kept beside the file", () => {
  const at = new Date(2026, 9, 20, 15, 4, 5);
  it("is named <name>.unsaved-<time>", () => {
    expect(copyPath("C:/w/notes.md", at)).toBe("C:/w/notes.md.unsaved-20261020-150405");
    expect(copyPath("C:/w/notes.md", at, 3)).toBe("C:/w/notes.md.unsaved-20261020-150405-3");
  });

  it("skips a taken name and never writes over a file", async () => {
    const files: Record<string, string> = { "C:/w/n.md.unsaved-20261020-150405": "older copy" };
    const io: CopyIo = { exists: async (p) => p in files, write: async (p, t) => void (files[p] = t) };
    const got = await keepUnsaved("C:/w/n.md", "mine", io, at);
    expect(got).toBe("C:/w/n.md.unsaved-20261020-150405-2");
    expect(files["C:/w/n.md.unsaved-20261020-150405"]).toBe("older copy");
    expect(files[got]).toBe("mine");
  });

  it("says where the text went, or that it stayed in the tab", () => {
    expect(keptToast("n.md", "C:/w/n.md.unsaved-1")).toContain("kept as n.md.unsaved-1");
    expect(keptToast("n.md", null, "denied")).toContain("stays in the tab");
  });
});
