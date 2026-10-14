import { expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { CHUNK, chunks, PASTE_LIMIT, pasteMark, pieceSpec, refusal, verdict } from "./paste";
import { refusePaste } from "./markdown";

test("EDIT-008: a paste at the chunk size goes in whole, one character more goes in pieces, past the limit it is refused, read-only never", () => {
  expect(verdict(0, false)).toBe("native");
  expect(verdict(CHUNK, false)).toBe("native");
  expect(verdict(CHUNK + 1, false)).toBe("chunked");
  expect(verdict(PASTE_LIMIT, false)).toBe("chunked");
  expect(verdict(PASTE_LIMIT + 1, false)).toBe("refused");
  expect(verdict(PASTE_LIMIT + 1, true)).toBe("ignore");
  expect(verdict(5, true)).toBe("ignore");
  expect(refusal(40 * 1024 * 1024)).toBe("Paste refused: 40 MB is over the 32 MB limit for one paste. Nothing was pasted.");
});

test("EDIT-008: pieces rebuild the text and never split an emoji or a CRLF", () => {
  const text = "ab\r\ncd😀ef";
  for (let size = 2; size <= 6; size++) {
    const parts = chunks(text, size);
    expect(parts.join("")).toBe(text);
    for (const p of parts) {
      expect(p.endsWith("\r")).toBe(false);
      const last = p.charCodeAt(p.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
      expect(p.length).toBeLessThanOrEqual(size);
    }
  }
  const big = "x".repeat(CHUNK * 3 + 7);
  expect(chunks(big).map((p) => p.length)).toEqual([CHUNK, CHUNK, CHUNK, 7]);
});

test("EDIT-008: a chunked paste replaces the selection and follows an edit made mid-paste", () => {
  let s = EditorState.create({ doc: "head SEL tail", selection: { anchor: 5, head: 8 }, extensions: [history(), pasteMark] });
  const parts = chunks("1234567890", 4); // 1234 5678 90
  s = s.update(pieceSpec(parts[0], true, 5, 8, false)).state;
  expect(s.doc.toString()).toBe("head 1234 tail");
  // The user types at the start while the paste is under way: the next piece still lands after the last.
  s = s.update({ changes: { from: 0, insert: ">" } }).state;
  let at = s.field(pasteMark)!;
  s = s.update(pieceSpec(parts[1], false, at, at, false)).state;
  at = s.field(pasteMark)!;
  s = s.update(pieceSpec(parts[2], false, at, at, true)).state;
  expect(s.doc.toString()).toBe(">head 1234567890 tail");
  expect(s.field(pasteMark)).toBe(null);
  expect(s.selection.main.head).toBe(16);
});

test("EDIT-008: one undo takes a whole chunked paste back", () => {
  let s = EditorState.create({ doc: "ab", selection: { anchor: 1 }, extensions: [history(), pasteMark] });
  const parts = chunks("x".repeat(10), 3);
  parts.forEach((p, i) => {
    const at = i === 0 ? 1 : s.field(pasteMark)!;
    s = s.update(pieceSpec(p, i === 0, at, at, i === parts.length - 1)).state;
  });
  expect(s.doc.toString()).toBe("a" + "x".repeat(10) + "b");
  const undone: EditorState[] = [];
  undo({ state: s, dispatch: (tr) => undone.push(tr.state) });
  expect(undone[0].doc.toString()).toBe("ab");
});

test("EDIT-008: the rich view refuses a paste past the limit and lets a normal one through", () => {
  const said: string[] = [];
  const ev = (text: string) => ({ clipboardData: { getData: () => text }, preventDefault: () => said.push("prevented") }) as unknown as ClipboardEvent;
  expect(refusePaste(ev("x".repeat(100)), (t) => said.push(t))).toBe(false);
  expect(said).toEqual([]);
  expect(refusePaste(ev("x".repeat(PASTE_LIMIT + 1)), (t) => said.push(t))).toBe(true);
  expect(said).toEqual(["prevented", refusal(PASTE_LIMIT + 1)]);
});
