import { expect, test, vi } from "vitest";
import { EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { busyRefusal, CHUNK, chunks, handlePaste, holdInput, PASTE_LIMIT, pasteChunked, pasteMark, pieceSpec, refusal, verdict } from "./paste";
import { refusePaste, RICH_LIMIT, richRefusal } from "./markdown";

test("EDIT-008: a paste at the chunk size goes in whole, one character more goes in pieces, past the limit it is refused, read-only never", () => {
  expect(verdict(0, false)).toBe("native");
  expect(verdict(CHUNK, false)).toBe("native");
  expect(verdict(CHUNK + 1, false)).toBe("chunked");
  expect(verdict(PASTE_LIMIT, false)).toBe("chunked");
  expect(verdict(PASTE_LIMIT + 1, false)).toBe("refused");
  expect(verdict(PASTE_LIMIT + 1, true)).toBe("ignore");
  expect(verdict(5, true)).toBe("ignore");
  expect(refusal(40 * 1024 * 1024)).toBe("Paste refused: 40 MB is over the 32 MB limit for one paste. Nothing was pasted.");
  expect(refusal(PASTE_LIMIT + 1)).toBe("Paste refused: it is just over the 32 MB limit for one paste. Nothing was pasted.");
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

// FIX-1 (council FIX-SOON 1): the pieces go in on timers; with more than the history's 500 ms
// grouping delay between them, one undo must still take the whole paste back, and the user's own
// keystrokes and clicks wait the paste out instead of landing inside it or splitting its undo step.
type Stub = { state: EditorState; dispatch: (spec: TransactionSpec | Transaction) => void };
const stubView = (state: EditorState): Stub => {
  const v: Stub = { state, dispatch: (spec) => (v.state = spec instanceof Transaction ? spec.state : v.state.update(spec).state) };
  return v;
};

test("EDIT-008: a chunked paste with over 500 ms between pieces is still one undo, and typing waits it out", () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(1_000_000);
    const v = stubView(EditorState.create({ doc: "ab", selection: { anchor: 1 }, extensions: [history(), pasteMark, holdInput] }));
    const text = "y".repeat(CHUNK * 2 + 5); // three pieces
    let finished = false;
    pasteChunked(v as unknown as EditorView, text, () => (finished = true));
    expect(v.state.doc.length).toBe(2 + CHUNK);
    // a keystroke and a click while the paste runs: both are held out
    v.dispatch({ changes: { from: 1, insert: "Z" }, userEvent: "input.type" });
    v.dispatch({ selection: { anchor: 0 }, userEvent: "select.pointer" });
    expect(v.state.doc.toString().includes("Z")).toBe(false);
    for (let i = 0; i < 5 && !finished; i++) {
      vi.setSystemTime(Date.now() + 700);
      vi.runOnlyPendingTimers();
    }
    expect(finished).toBe(true);
    expect(v.state.doc.toString()).toBe("a" + text + "b");
    expect(v.state.field(pasteMark)).toBe(null);
    // the paste is over: typing works again, as its own undo step after the paste's
    vi.setSystemTime(Date.now() + 100);
    v.dispatch({ changes: { from: 0, insert: "T" }, userEvent: "input.type" });
    expect(v.state.doc.toString()).toBe("Ta" + text + "b");
    undo(v as unknown as EditorView);
    expect(v.state.doc.toString()).toBe("a" + text + "b");
    undo(v as unknown as EditorView);
    expect(v.state.doc.toString()).toBe("ab");
  } finally {
    vi.useRealTimers();
  }
});

test("EDIT-008 (FIX-1): the rich view takes a paste only up to its own size limit and says where to paste a bigger one", () => {
  const said: string[] = [];
  const ev = (text: string) => ({ clipboardData: { getData: () => text }, preventDefault: () => said.push("prevented") }) as unknown as ClipboardEvent;
  expect(refusePaste(ev("x".repeat(RICH_LIMIT)), (t) => said.push(t))).toBe(false);
  expect(said).toEqual([]);
  expect(refusePaste(ev("x".repeat(RICH_LIMIT + 1)), (t) => said.push(t))).toBe(true);
  expect(said).toEqual(["prevented", richRefusal(RICH_LIMIT + 1)]);
  expect(richRefusal(10 * 1024 * 1024)).toBe("Paste refused in the rich view: 10 MB is over the 600 KB it takes in one paste. Paste it in source view instead. Nothing was pasted.");
  expect(richRefusal(RICH_LIMIT + 1)).toBe("Paste refused in the rich view: it is just over the 600 KB it takes in one paste. Paste it in source view instead. Nothing was pasted.");
});

// FIX-5 (council P1 AFTER 4): the limit is on the note the paste would make, not on the paste alone.
test("EDIT-008 (FIX-5): the rich view counts what the note already holds, so two pastes under the limit cannot add up past it", () => {
  const said: string[] = [];
  const ev = (text: string) => ({ clipboardData: { getData: () => text }, preventDefault: () => said.push("prevented") }) as unknown as ClipboardEvent;
  const half = Math.floor(RICH_LIMIT / 2);
  expect(refusePaste(ev("x".repeat(half)), (t) => said.push(t), half)).toBe(false); // exactly at the limit: taken
  expect(said).toEqual([]);
  expect(refusePaste(ev("x".repeat(half + 2)), (t) => said.push(t), half)).toBe(true); // 2 over: refused
  expect(said).toEqual(["prevented", richRefusal(half + 2, half)]);
  expect(richRefusal(half + 2, half)).toBe("Paste refused in the rich view: the note would be just over the 600 KB the rich view takes. Paste it in source view instead. Nothing was pasted.");
  expect(richRefusal(1000, 700 * 1024)).toBe("Paste refused in the rich view: the note would be 701 KB, over the 600 KB the rich view takes. Paste it in source view instead. Nothing was pasted.");
});

// FIX-2 (council FS-3): a second paste while the first is still going in is refused out loud and
// leaves the first paste whole; a piece that throws clears the hold so the editor takes input again.
test("EDIT-008 (FIX-2): a second paste mid-paste is refused with a toast, and a failing piece does not hold input forever", () => {
  vi.useFakeTimers();
  try {
    const v = stubView(EditorState.create({ doc: "ab", selection: { anchor: 1 }, extensions: [history(), pasteMark, holdInput] }));
    const text = "y".repeat(CHUNK * 2 + 5);
    pasteChunked(v as unknown as EditorView, text);
    const said: string[] = [];
    const ev = (t: string) => ({ clipboardData: { getData: () => t }, preventDefault: () => said.push("prevented") }) as unknown as ClipboardEvent;
    expect(handlePaste(ev("small"), v as unknown as EditorView, (t) => said.push(t))).toBe(true);
    expect(handlePaste(ev("z".repeat(CHUNK + 1)), v as unknown as EditorView, (t) => said.push(t))).toBe(true);
    expect(said).toEqual(["prevented", busyRefusal, "prevented", busyRefusal]);
    vi.runAllTimers();
    expect(v.state.doc.toString()).toBe("a" + text + "b");
    expect(handlePaste(ev("small"), v as unknown as EditorView, (t) => said.push(t))).toBe(false);

    const w = stubView(EditorState.create({ doc: "", extensions: [pasteMark, holdInput] }));
    pasteChunked(w as unknown as EditorView, text);
    const real = w.dispatch;
    w.dispatch = (spec) => {
      if (!(spec instanceof Transaction) && "changes" in spec) throw new Error("boom");
      real(spec);
    };
    expect(() => vi.runOnlyPendingTimers()).toThrow("boom");
    expect(w.state.field(pasteMark)).toBe(null);
  } finally {
    vi.useRealTimers();
  }
});

// FIX-3 (council AFTER 6): when the view is gone, the release in the catch throws too. The failure
// still ends the paste (done runs, so nothing waits on it) and the piece's own error is the one
// reported, not the release's.
test("EDIT-008 (FIX-3): a piece failing on a view that is gone still ends the paste with the piece's error", () => {
  vi.useFakeTimers();
  try {
    const w = stubView(EditorState.create({ doc: "", extensions: [pasteMark, holdInput] }));
    let ended = 0;
    pasteChunked(w as unknown as EditorView, "y".repeat(CHUNK * 2 + 5), () => (ended += 1));
    w.dispatch = (spec) => {
      throw new Error(!(spec instanceof Transaction) && "changes" in spec ? "boom" : "view destroyed");
    };
    expect(() => vi.runOnlyPendingTimers()).toThrow("boom");
    expect(ended).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});
