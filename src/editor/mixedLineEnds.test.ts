// T-603, DT-C57 (Txais, 2026-10-31, option a): a file that holds both CRLF and LF lines draws every
// line on its own, and a save writes it back ending by ending, byte for byte. The fixture is a real
// file on disk, read as its own bytes; the first test saves it and compares what was written with it.
import { afterEach, describe, expect, it } from "vitest";
import { EditorState, type Transaction } from "@codemirror/state";
import { attach, detach, docText, fileText, isDirty, lineEndsFor, relay, replaceAll, save, withLineBreaks, type View } from "./buffers";
import { richChange } from "./frontMatter";
import { roundTrip } from "./markdown";
import fixture from "./__fixtures__/mixed-eol.txt?raw";

const opened: [string, View][] = [];
afterEach(() => opened.splice(0).forEach(([p, v]) => detach(p, v)));

/** A tab built as EditorPane builds it: the doc is what the editor draws, the extensions keep the endings. */
function tab(path: string, disk: string): View & { type: (at: number, s: string) => void } {
  const v = {
    state: EditorState.create({ doc: docText(disk), extensions: lineEndsFor(disk) }),
    dispatch(spec: Parameters<View["dispatch"]>[0]) {
      const tr: Transaction = v.state.update(spec);
      v.state = tr.state;
      relay(path, v, tr);
    },
    type(at: number, s: string) {
      v.dispatch({ changes: { from: at, to: at, insert: s }, annotations: [] });
    },
  };
  opened.push([path, v]);
  attach(path, v, disk);
  return v;
}

describe("a file with mixed CRLF and LF lines (T-603, DT-C57)", () => {
  it("opens with every line on its own and saves the very bytes it was read from", async () => {
    const path = "C:\\w\\mixed-eol.txt";
    const disk = fixture;
    expect(disk).toContain("\r\n");
    expect(disk.replace(/\r\n/g, "")).toContain("\n"); // it really mixes the two
    const v = tab(path, disk);
    expect(v.state.doc.lines).toBe(5);
    expect([1, 2, 3, 4].map((n) => v.state.doc.line(n).text)).toEqual(["alpha line", "beta line", "gamma line", "delta line"]);
    expect(isDirty(path)).toBe(false);
    const writes: string[] = [];
    await save(path, async (t) => void writes.push(t));
    expect(writes).toEqual([disk]); // the fixture's own bytes, CRLF and LF where they were
  });

  it("keeps each line's own ending while a line is edited and a line is added", async () => {
    const p = "C:\\w\\mixed.md";
    const disk = "alpha\r\nbeta\ngamma\r\ndelta\n";
    const v = tab(p, disk);
    v.type(v.state.doc.line(2).to, " (edited)");
    v.type(v.state.doc.length, "new line\n");
    const writes: string[] = [];
    await save(p, async (t) => void writes.push(t));
    expect(writes).toEqual(["alpha\r\nbeta (edited)\ngamma\r\ndelta\nnew line\n"]);
  });

  it("a rewrite on disk that mixes the endings is read as its own lines, and back again", () => {
    const p = "C:\\w\\mixed.log";
    const v = tab(p, "one\ntwo\n");
    const mixed = "one\r\ntwo\nthree\r\nfour\n";
    replaceAll(p, mixed);
    expect(v.state.doc.lines).toBe(5);
    expect([1, 2, 3, 4].map((n) => v.state.doc.line(n).text)).toEqual(["one", "two", "three", "four"]);
    expect(fileText(v.state)).toBe(mixed);
    expect(isDirty(p)).toBe(false);
    replaceAll(p, "one\r\ntwo\nthree\r\nfour\nfive\n");
    expect(v.state.doc.line(5).text).toBe("five");
    expect(fileText(v.state)).toBe("one\r\ntwo\nthree\r\nfour\nfive\n");
  });

  it("an edit placed by the rich view keeps every existing line's ending", () => {
    const p = "C:\\w\\mixed.md";
    const disk = "# Title\r\n\r\nFirst paragraph.\n\nSecond paragraph.\r\n";
    const v = tab(p, disk);
    const now = v.state.doc.toString();
    const prev = roundTrip(now)!;
    const out = prev.replace("First paragraph.\n", "First paragraph.\n\nTyped in the rich view.\n");
    const change = richChange(now, out, prev, () => expect.fail("the edit was refused"))!;
    v.dispatch({ changes: withLineBreaks(v.state, change), annotations: [] });
    expect(fileText(v.state)).toBe("# Title\r\n\r\nFirst paragraph.\n\nTyped in the rich view.\n\nSecond paragraph.\r\n");
  });
});
