import { expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { attach, detach, isDirty, lineEndsFor, opening, relay, replaceAll, save, textOf, type View } from "./editors";
import { followStep, followTick, type FollowIo } from "./logFollow";

test("EDIT-026: lines appended to the log show; nothing new shows nothing", () => {
  expect(followStep("a\n", "a\nb\nc\n")).toEqual({ text: "a\nb\nc\n", reset: false });
  expect(followStep("a\nb\n", "a\nb\n")).toBeNull();
});

test("EDIT-026: a partly written line is held back until it is complete", () => {
  expect(followStep("a\n", "a\nb")).toBeNull();
  expect(followStep("a\n", "a\nb\nc")).toEqual({ text: "a\nb\n", reset: false });
  expect(followStep("a\n", "a\nb\n")).toEqual({ text: "a\nb\n", reset: false });
});

test("EDIT-026: an emptied, rotated or cut log starts again from the top", () => {
  expect(followStep("a\nb\n", "")).toEqual({ text: "", reset: true });
  expect(followStep("a\nb\n", "x\n")).toEqual({ text: "x\n", reset: true });
  expect(followStep("a\nb\n", "a\n")).toEqual({ text: "a\n", reset: true });
  expect(followStep("", "")).toBeNull();
});

// T-317 review: Follow log opens a second view of a .log that a plain tab may already show; both share one buffer
// (EDIT-001), so the follow tick must never lay the file over unsaved edits (EDIT-003). Views are built as EditorPane
// builds them, the tick is the one EditorPane runs each second, the file is a fake stamp and text.
function tabs(path: string, disk: { text: string; stamp: string }) {
  const editorOf = (text: string): View & { type: (at: number, s: string) => void } => {
    const v = {
      state: EditorState.create({ doc: text, extensions: lineEndsFor(text) }),
      dispatch(spec: Parameters<View["dispatch"]>[0]) {
        const tr = v.state.update(spec);
        v.state = tr.state;
        relay(path, v, tr);
      },
      type(at: number, s: string) {
        v.dispatch({ changes: { from: at, to: at, insert: s }, annotations: [] });
      },
    };
    return v;
  };
  const plain = editorOf(disk.text);
  attach(path, plain, disk.text);
  const io: FollowIo & { reads: number } = {
    reads: 0,
    stamp: async () => disk.stamp,
    read: async () => (io.reads++, disk.text),
    dirty: () => isDirty(path),
    shown: () => textOf(path) ?? "",
    show: (next) => replaceAll(path, next.text),
  };
  const follow = () => {
    const o = opening(path, disk.text); // the followed tab opens on the plain tab's text
    const followed = editorOf(o.text);
    attach(path, followed, o.base);
    return followed;
  };
  return { plain, io, follow };
}

test("T-317 (EDIT-003): Follow log never replaces unsaved edits in a plain tab of the same log; it waits, then follows again once they are saved", async () => {
  const p = "C:\\w\\logs\\a.log";
  const disk = { text: "line 1\nline 2\n", stamp: "1" };
  const { plain, io, follow } = tabs(p, disk);
  plain.type(0, "MY NOTE: keep this\n");
  const followed = follow();
  const mine = "MY NOTE: keep this\nline 1\nline 2\n";
  let last = await followTick("", io); // the first tick, as the followed tab opens
  expect([plain.state.sliceDoc(), followed.state.sliceDoc(), isDirty(p)]).toEqual([mine, mine, true]);
  disk.text += "line 3\n"; // the log grows while the edits are unsaved
  disk.stamp = "2";
  last = await followTick(last, io);
  last = await followTick(last, io);
  expect([plain.state.sliceDoc(), isDirty(p)]).toEqual([mine, true]);
  expect(io.reads).toBe(0); // nothing is read while it waits, and the stamp is not taken, so every second tries again
  expect(last).toBe("");
  await save(p, async (t) => void ((disk.text = t), (disk.stamp = "3")), true); // Keep mine writes the edits
  last = await followTick(last, io);
  disk.text += "line 4\n";
  disk.stamp = "4";
  last = await followTick(last, io);
  expect([plain.state.sliceDoc(), followed.state.sliceDoc(), isDirty(p), last]).toEqual([mine + "line 4\n", mine + "line 4\n", false, "4"]);
  detach(p, plain);
  detach(p, followed);
});

test("T-317 (EDIT-003): typing that starts while the followed log is being read is kept too", async () => {
  const p = "C:\\w\\logs\\b.log";
  const disk = { text: "one\n", stamp: "1" };
  const { plain, io, follow } = tabs(p, disk);
  const followed = follow();
  disk.text = "one\ntwo\n";
  disk.stamp = "2";
  const read = io.read;
  io.read = async () => (plain.type(0, "typed "), read()); // a key pressed in the plain tab while the read is out
  const last = await followTick("1", io);
  expect([plain.state.sliceDoc(), isDirty(p), last]).toEqual(["typed one\n", true, "1"]);
  detach(p, plain);
  detach(p, followed);
});
