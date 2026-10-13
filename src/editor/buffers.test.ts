import { describe, expect, it } from "vitest";
import { EditorState, type Transaction } from "@codemirror/state";
import { attach, detach, hashOf, isDirty, isStale, keyOf, loadText, relay, replaceAll, sameText, save, subscribe, type View } from "./buffers";

/** A stand-in for an editor view: a state that takes transactions and reports them to the buffer. */
function fakeView(path: string, text: string, eol?: string): View & { type: (at: number, s: string) => void } {
  const v = {
    state: EditorState.create({ doc: text, extensions: eol ? EditorState.lineSeparator.of(eol) : [] }),
    dispatch(spec: Parameters<View["dispatch"]>[0]) {
      const tr: Transaction = v.state.update(spec);
      v.state = tr.state;
      relay(path, v, tr);
    },
    type(at: number, s: string) {
      const tr = v.state.update({ changes: { from: at, insert: s } });
      v.state = tr.state;
      relay(path, v, tr);
    },
  };
  return v;
}

describe("unsaved marker (EDIT-001)", () => {
  it("ignores whitespace at line ends only", () => {
    expect(sameText("a  \nb\n", "a\nb")).toBe(true);
    expect(sameText("a\r\nb \r\n", "a\r\nb\r\n")).toBe(true);
    expect(sameText("a b", "ab")).toBe(false);
    expect(sameText("x", "y")).toBe(false);
  });

  it("shows after typing and clears after one save", async () => {
    const p = "C:\\w\\main.rs";
    const v = fakeView(p, "fn main() {}\n");
    attach(p, v, "fn main() {}\n");
    expect(isDirty(p)).toBe(false);
    v.type(0, "x");
    expect(isDirty(p)).toBe(true);
    const writes: string[] = [];
    await save(p, async (t) => void writes.push(t));
    expect(writes).toEqual(["xfn main() {}\n"]);
    expect(isDirty(p)).toBe(false);
    detach(p, v);
  });

  it("a failed save keeps the marker", async () => {
    const p = "C:\\w\\fail.rs";
    const v = fakeView(p, "a");
    attach(p, v, "a");
    v.type(1, "b");
    await expect(save(p, async () => Promise.reject(new Error("denied")))).rejects.toThrow("denied");
    expect(isDirty(p)).toBe(true);
    detach(p, v);
  });
});

describe("a save never overwrites a change made on disk unseen (EDIT-003, T-073-a)", () => {
  it("sends the hash of the loaded text, then of what it saved; Keep mine sends none", async () => {
    expect(await hashOf("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const p = "C:/w/hash.md";
    const v = fakeView(p, "one");
    attach(p, v, "one");
    v.type(3, " two");
    const sent: (string | undefined)[] = [];
    await save(p, async (_t, h) => void sent.push(h));
    v.type(0, "x");
    await save(p, async (_t, h) => void sent.push(h), true);
    expect(sent).toEqual([await hashOf("one"), undefined]);
    detach(p, v);
  });

  it("a refused save keeps the edits unsaved and the loaded hash", async () => {
    const p = "C:/w/stale.md";
    const v = fakeView(p, "disk");
    attach(p, v, "disk");
    v.type(4, "!");
    const refuse = async () => Promise.reject("stale: the file changed on disk since it was opened");
    const err = await save(p, refuse).catch((e) => e);
    expect(isStale(err)).toBe(true);
    expect(isDirty(p)).toBe(true);
    const sent: (string | undefined)[] = [];
    await save(p, async (_t, h) => void sent.push(h));
    expect(sent).toEqual([await hashOf("disk")]);
    detach(p, v);
  });

  it("knows the stale refusal from other errors", () => {
    expect(isStale({ kind: "stale", message: "changed" })).toBe(true);
    expect(isStale("stale: changed")).toBe(true);
    expect(isStale("could not save C:/w/a.md: denied")).toBe(false);
    expect(isStale({ kind: "denied" })).toBe(false);
  });
});

describe("one file in two panes (EDIT-001)", () => {
  it("keystrokes reach both, a save writes once, a reload leaves both clean", async () => {
    const p = "C:\\w\\twin.ts";
    const a = fakeView(p, "one");
    const b = fakeView("c:/w/TWIN.ts", "one");
    attach(p, a, "one");
    attach("c:/w/TWIN.ts", b, "one");
    let told = 0;
    const off = subscribe(p, () => told++);
    a.type(3, " two");
    expect(b.state.doc.toString()).toBe("one two");
    b.type(0, ">");
    expect(a.state.doc.toString()).toBe(">one two");
    const writes: string[] = [];
    await save(p, async (t) => void writes.push(t));
    expect(writes).toHaveLength(1);
    replaceAll(p, "fresh");
    expect([a.state.doc.toString(), b.state.doc.toString(), isDirty(p)]).toEqual(["fresh", "fresh", false]);
    expect(told).toBeGreaterThan(0);
    off();
    detach(p, a);
    detach(p, b);
  });

  it("a view attached later shows the twin's unsaved text", () => {
    const p = "C:\\w\\late.ts";
    const a = fakeView(p, "x");
    attach(p, a, "x");
    a.type(1, "y");
    const b = fakeView(p, "x");
    attach(p, b, "x");
    expect(b.state.doc.toString()).toBe("xy");
    expect(keyOf("C:\\A\\b.ts")).toBe(keyOf("c:/a/B.TS"));
    detach(p, a);
    detach(p, b);
  });
});

describe("line ends (EDIT-001)", () => {
  it("a Windows file is clean as loaded and saved with its own line ends", async () => {
    const p = "C:\\w\\crlf.txt";
    const disk = "one\r\ntwo\r\n";
    const v = fakeView(p, disk, "\r\n");
    attach(p, v, disk);
    expect(isDirty(p)).toBe(false);
    v.type(0, "z");
    const writes: string[] = [];
    await save(p, async (t) => void writes.push(t));
    expect(writes).toEqual(["zone\r\ntwo\r\n"]);
    detach(p, v);
  });
});

describe("loading (EDIT-001)", () => {
  it("retries a few times, then gives the last error", async () => {
    let n = 0;
    await expect(loadText(async () => (++n < 3 ? Promise.reject(new Error("busy")) : "ok"), 3, 1)).resolves.toBe("ok");
    n = 0;
    await expect(loadText(async () => Promise.reject(new Error(`no ${++n}`)), 3, 1)).rejects.toThrow("no 3");
  });
});
