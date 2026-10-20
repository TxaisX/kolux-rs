import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { attach, detach, hashOf, type View } from "./buffers";
import { createDrafts, flushOnLeave, restoreFrom, type Draft, type DraftIo } from "./drafts";

// EDIT-004 (T-177): unsaved text is kept as a draft, brought back unsaved, and never written into the file.
const P = "C:/w/drafts-note.md";
const W = "C:/w";
let view: View | null = null;
function open(path: string, disk: string, typed: string): View {
  let state = EditorState.create({ doc: typed });
  const v = {
    get state() {
      return state;
    },
    dispatch: (spec: { changes: unknown }) => {
      state = state.update({ changes: spec.changes as never }).state;
    },
  } as unknown as View;
  attach(path, v, disk);
  view = v;
  return v;
}
afterEach(() => {
  if (view) detach(P, view);
  view = null;
});

function rig(initial: Draft[] = []) {
  const store = new Map<string, Draft>(initial.map((d) => [d.path, d]));
  const calls: string[] = [];
  const io: DraftIo = {
    set: async (_w, path, text, base) => void (calls.push("set"), store.set(path, { path, text, base })),
    clear: async (_w, path) => void (calls.push("clear"), store.delete(path)),
    list: async () => [...store.values()],
  };
  const jobs: (() => void)[] = [];
  const timers = { set: (f: () => void) => (jobs.push(f), jobs.length), clear: () => undefined };
  const run = async () => {
    jobs.splice(0).forEach((f) => f());
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  };
  return { d: createDrafts(io, 600, timers), store, calls, run };
}

describe("coming back after a quit", () => {
  it("an unsaved tab keeps a draft of its text and the hash of the disk copy it was typed over", async () => {
    const r = rig();
    open(P, "disk\n", "disk\nand my edit\n");
    r.d.edited(W, P);
    await r.run();
    expect(r.store.get(P)).toEqual({ path: P, text: "disk\nand my edit\n", base: await hashOf("disk\n") });
  });

  it("reopening the file shows the draft, unsaved, when the disk copy is the one it was typed over", async () => {
    const disk = "disk\n";
    const draft = { path: P, text: "disk\nedit\n", base: await hashOf(disk) };
    const r = rig([draft]);
    const got = await r.d.take(W, P);
    expect(restoreFrom(disk, await hashOf(disk), got)).toEqual({ text: "disk\nedit\n", moved: false, stale: false });
  });

  it("a draft over a disk copy that changed meanwhile comes back with the banner up, not over the new copy unseen", async () => {
    const draft = { path: P, text: "old\nedit\n", base: await hashOf("old\n") };
    const out = restoreFrom("new from outside\n", await hashOf("new from outside\n"), draft);
    expect(out).toEqual({ text: "old\nedit\n", moved: true, stale: false });
  });

  it("a draft equal to the disk copy (apart from trailing spaces) is dropped, not shown as unsaved", async () => {
    const out = restoreFrom("same\n", await hashOf("same\n"), { path: P, text: "same  \n", base: "x" });
    expect(out).toEqual({ text: "same\n", moved: false, stale: true });
    expect(restoreFrom("a", await hashOf("a"), null)).toEqual({ text: "a", moved: false, stale: false });
  });
});

describe("keeping drafts tidy", () => {
  it("saving the file (the tab is clean again) removes the draft", async () => {
    const r = rig([{ path: P, text: "edit", base: "h" }]);
    await r.d.take(W, P);
    open(P, "edit", "edit"); // saved: the text equals the disk copy
    r.d.edited(W, P);
    await r.run();
    expect(r.store.has(P)).toBe(false);
  });

  it("a read-only tab never carries a draft", async () => {
    const r = rig();
    open(P, "a", "ab");
    r.d.edited(W, P, true);
    expect(r.d.pending(W, P)).toBe(false);
    await r.run();
    expect(r.calls).toEqual([]);
  });

  it("typing in bursts is one waiting write, and closing the tab discards the draft", async () => {
    const r = rig();
    open(P, "a", "ab");
    r.d.edited(W, P);
    r.d.edited(W, P);
    expect(r.d.pending(W, P)).toBe(true);
    await r.run();
    expect(r.store.has(P)).toBe(true);
    await r.d.discard(W, P);
    expect(r.store.has(P)).toBe(false);
    expect(await r.d.take(W, P)).toBeNull();
  });

  it("the file on disk is never touched: the writer only calls the draft store", async () => {
    const r = rig();
    open(P, "a", "ab");
    r.d.edited(W, P);
    await r.run();
    expect(new Set(r.calls)).toEqual(new Set(["set"]));
  });
});

describe("row 135: the last moment of typing reaches the draft", () => {
  it("flushAll writes a draft still waiting for typing to stop", async () => {
    const r = rig();
    open(P, "disk\n", "disk\nlast words\n");
    r.d.edited(W, P);
    expect(r.store.size).toBe(0);
    await r.d.flushAll();
    expect(r.store.get(P)?.text).toBe("disk\nlast words\n");
    expect(r.d.pending(W, P)).toBe(false);
  });

  it("the window losing focus, hiding or unloading flushes; after unhooking it does not", () => {
    const t = new EventTarget();
    let n = 0;
    const off = flushOnLeave(t as unknown as Window, () => n++);
    t.dispatchEvent(new Event("blur"));
    t.dispatchEvent(new Event("pagehide"));
    expect(n).toBe(2);
    off();
    t.dispatchEvent(new Event("blur"));
    expect(n).toBe(2);
  });
});
