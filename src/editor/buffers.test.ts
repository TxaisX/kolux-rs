import { describe, expect, it } from "vitest";
import { EditorState, type Transaction } from "@codemirror/state";
import { attach, detach, hashOf, isDirty, isStale, keyOf, lineEndsFor, loadText, relay, replaceAll, sameText, save, subscribe, withLineBreaks, type View } from "./buffers";
import { richChange } from "./frontMatter";
import { roundTrip } from "./markdown";

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

// T-603 (audit F01-editor.2 and .4): the real path. The tab's editor is built as EditorPane builds it (lineEndsFor of the
// text read), the rich view is handed doc.toString() (lines joined with \n, as the app does), and its edit goes in through
// the tab's own dispatch (withLineBreaks); a reload goes through replaceAll, as the disk check does.
describe("line ends survive the rich view and a rewrite on disk (T-603)", () => {
  const editorOf = (path: string, text: string): View => {
    const v: View = {
      state: EditorState.create({ doc: text, extensions: lineEndsFor(text) }),
      dispatch(spec) {
        const tr = v.state.update(spec);
        v.state = tr.state;
        relay(path, v, tr);
      },
    };
    return v;
  };

  it("F01-editor.2: a paragraph typed in the rich view of a CRLF note is saved with CRLF and shows as its own lines", async () => {
    const p = "C:\\w\\readme.md";
    const disk = "# Title\r\n\r\nFirst paragraph.\r\n\r\nSecond paragraph.\r\n";
    const v = editorOf(p, disk);
    attach(p, v, disk);
    const now = v.state.doc.toString();
    const prev = roundTrip(now)!;
    const out = prev.replace("First paragraph.\n", "First paragraph.\n\nA new paragraph typed in the rich view.\n");
    const change = richChange(now, out, prev, () => expect.fail("the edit was refused"))!;
    v.dispatch({ changes: withLineBreaks(v.state, change), annotations: [] });
    const want = "# Title\r\n\r\nFirst paragraph.\r\n\r\nA new paragraph typed in the rich view.\r\n\r\nSecond paragraph.\r\n";
    expect(v.state.sliceDoc()).toBe(want);
    expect(v.state.doc.lines).toBe(8);
    expect(v.state.doc.line(5).text).toBe("A new paragraph typed in the rich view.");
    const writes: string[] = [];
    await save(p, async (t) => void writes.push(t));
    expect(writes).toEqual([want]);
    detach(p, v);
  });

  it("F01-editor.2: a notebook cell edit in a CRLF notebook keeps the notebook's lines and line ends", () => {
    const disk = '{\r\n "cells": [],\r\n "nbformat": 4\r\n}\r\n';
    const state = EditorState.create({ doc: disk, extensions: lineEndsFor(disk) });
    const next = state.update({ changes: withLineBreaks(state, { from: 0, to: state.doc.length, insert: '{\n "cells": [1],\n "nbformat": 4\n}\n' }) }).state;
    expect(next.sliceDoc()).toBe('{\r\n "cells": [1],\r\n "nbformat": 4\r\n}\r\n');
    expect(next.doc.lines).toBe(5);
  });

  it("F01-editor.4: a CRLF file rewritten with LF on disk reloads as its own lines, and back again without stray CRs", () => {
    const p = "C:\\w\\long.ts";
    const crlf = Array.from({ length: 300 }, (_, i) => `const line${i + 1} = ${i + 1};`).join("\r\n") + "\r\n";
    const lf = crlf.replace(/\r\n/g, "\n");
    const v = editorOf(p, crlf);
    attach(p, v, crlf);
    replaceAll(p, lf); // a formatter rewrote the file with LF; the clean tab reloads quietly
    expect(v.state.doc.lines).toBe(301);
    expect(v.state.doc.line(120).text).toBe("const line120 = 120;"); // a file:line link lands on its line
    expect(v.state.sliceDoc()).toBe(lf);
    expect(isDirty(p)).toBe(false);
    replaceAll(p, crlf); // and back to CRLF
    expect(v.state.doc.lines).toBe(301);
    expect(v.state.doc.line(2).text).toBe("const line2 = 2;"); // no CR left at the end of the line
    expect(v.state.sliceDoc()).toBe(crlf);
    expect(isDirty(p)).toBe(false);
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

  it("edit046: gives up at once on a binary, oversize or non-UTF-8 file instead of retrying", async () => {
    for (const msg of ["C:/r/a.zip is a binary file, so it is not shown as text", "C:/r/x.log is too large to open (40 MB; the editor opens up to 32 MB)", "C:/r/l.txt is not UTF-8 text"]) {
      let n = 0;
      await expect(loadText(async () => Promise.reject(`${msg} #${++n}`), 3, 1)).rejects.toContain("#1");
      expect(n).toBe(1);
    }
  });
});
