// TERM-068: a paste lands only in the pane whose text area received it, and a paste made while the
// opening prompt is still owed waits for it (T-010-fix). Node's EventTarget stands in for the text areas.
import { expect, test } from "vitest";
import { attachPaste, bracketed, BRACKET_CLOSE, BRACKET_OPEN, CHUNK, cutChunks, LIMIT, needsAsk, prepareForTerminal } from "./paste";

const paste = (target: EventTarget, text: string) => {
  const e = Object.assign(new Event("paste", { cancelable: true }), { clipboardData: { getData: () => text } });
  target.dispatchEvent(e);
  return e;
};

test("T-151-b: 2+ lines into a program without bracketed paste asks first; bracketed paste on or one line never asks", () => {
  expect(needsAsk("echo one\necho two", true)).toBe(false); // bracketed paste on → no ask
  expect(needsAsk("echo one", false)).toBe(false); // one line → no ask
  expect(needsAsk("echo one\n", false)).toBe(false); // one line with its line end → one line (the end is dropped, below)
  expect(needsAsk("echo one\necho two", false)).toBe(true); // 2+ lines, no brackets → ask
  expect(needsAsk("a\r\nb\r\nc", false)).toBe(true);
  expect(needsAsk("a\rb\rc", false)).toBe(true); // council D2 MERGE 47 F1: a bare CR ends a line too
  expect(needsAsk("a\rb", false)).toBe(true);
  // through attachPaste: the ask gets the count and a go; Cancel (not calling go) sends nothing, Paste sends it
  const t = new EventTarget();
  const got: string[] = [];
  let asked: { lines: number; go: () => void } | null = null;
  attachPaste(t, (s) => got.push(s), () => false, () => {}, () => false, () => false, (lines, go) => (asked = { lines, go }));
  paste(t, "echo one\necho two\necho three");
  expect(asked).toEqual({ lines: 3, go: expect.any(Function) });
  expect(got).toEqual([]); // Cancel: nothing went
  asked!.go(); // Paste
  expect(got).toEqual(["echo one\recho two\recho three"]);
  asked = null;
  paste(t, "echo one");
  expect(asked).toBeNull();
  expect(got).toEqual(["echo one\recho two\recho three", "echo one"]);
});

test("council D2 MERGE 47 F1: a single line ending in a line end is typed without it, so it never runs by itself", () => {
  const t = new EventTarget();
  const got: string[] = [];
  let asked = 0;
  attachPaste(t, (s) => got.push(s), () => false, () => {}, () => false, () => true, () => asked++);
  paste(t, "evil-cmd\n");
  paste(t, "x\r");
  paste(t, "y\r\n");
  paste(t, "\n"); // nothing left: nothing sent
  expect(got).toEqual(["evil-cmd", "x", "y"]);
  expect(asked).toBe(0);
  paste(t, "a\rb\rc"); // three lines by CR alone → the ask, nothing sent yet
  expect(asked).toBe(1);
  expect(got).toHaveLength(3);
});

test("TERM-069: on Windows a multi-line paste is bracketed even when the program has not asked; single-line text keeps the fast path", () => {
  const t = new EventTarget();
  const got: string[] = [];
  attachPaste(t, (s) => got.push(s), () => false, () => {}, () => false, () => true);
  paste(t, "echo one\necho two\necho three");
  expect(got).toEqual([BRACKET_OPEN + "echo one\recho two\recho three" + BRACKET_CLOSE]);
  got.length = 0;
  paste(t, "echo one");
  expect(got).toEqual(["echo one"]);
  // off (not Windows): the program's own mode decides, as before
  const u = new EventTarget();
  const plain: string[] = [];
  attachPaste(u, (s) => plain.push(s), () => false, () => {}, () => false, () => false);
  paste(u, "echo one\necho two");
  expect(plain).toEqual(["echo one\recho two"]);
});

test("a paste into pane B reaches B only, even with pane A open first; the browser's default is cancelled", () => {
  const a = new EventTarget();
  const b = new EventTarget();
  const gotA: string[] = [];
  const gotB: string[] = [];
  attachPaste(a, (t) => gotA.push(t), () => false);
  attachPaste(b, (t) => gotB.push(t), () => false);
  const e = paste(b, "ls -la");
  expect(gotB).toEqual(["ls -la"]);
  expect(gotA).toEqual([]);
  expect(e.defaultPrevented).toBe(true);
  paste(a, "");
  expect(gotA).toEqual([]);
});

test("a paste made while the opening prompt is owed waits, then goes in order; detach stops listening", () => {
  const t = new EventTarget();
  const got: string[] = [];
  let held = true;
  const p = attachPaste(t, (s) => got.push(s), () => held);
  paste(t, "one");
  paste(t, "two");
  expect(got).toEqual([]);
  held = false;
  p.flush();
  expect(got).toEqual(["one", "two"]);
  p.detach();
  paste(t, "three");
  expect(got).toEqual(["one", "two"]);
});

// TERM-071: a large paste goes in CHUNK-sized pieces with a timer tick between them; over LIMIT nothing is sent.
test("a 3 MB paste is fed in 64 KB chunks across timer ticks, in order; the app runs between them", async () => {
  const t = new EventTarget();
  const got: string[] = [];
  attachPaste(t, (s) => got.push(s), () => false);
  const big = "x".repeat(3 * 1024 * 1024 + 7);
  paste(t, big);
  expect(got).toHaveLength(1); // the first chunk goes at once, the rest after a tick each
  expect(got[0]).toHaveLength(CHUNK);
  await new Promise((r) => setTimeout(r, 0));
  expect(got.length).toBeGreaterThanOrEqual(2);
  while (got.join("").length < big.length) await new Promise((r) => setTimeout(r, 0));
  expect(got).toHaveLength(49);
  expect(got.join("")).toBe(big);
});

test("a paste over the limit shows a message and sends nothing", () => {
  const t = new EventTarget();
  const got: string[] = [];
  const said: string[] = [];
  attachPaste(t, (s) => got.push(s), () => false, (m) => said.push(m));
  paste(t, "y".repeat(LIMIT + 1));
  expect(got).toEqual([]);
  expect(said).toEqual(["Paste of 8.0 MB is over the 8.0 MB limit; nothing was sent"]);
  paste(t, "y".repeat(12 * 1024 * 1024));
  expect(said[1]).toBe("Paste of 12 MB is over the 8.0 MB limit; nothing was sent");
  expect(got).toEqual([]);
});

// Council D2 MERGE 31 (2): chunk cuts never corrupt, one bracket pair per paste, each chunk after the previous
// landed, and Ctrl+C / Esc drop the rest.
test("a CRLF straddling the 64 KB cut stays together and becomes one carriage return", async () => {
  const text = "a".repeat(CHUNK - 1) + "\r\n" + "b".repeat(10);
  expect(cutChunks(text).map((c) => c.length)).toEqual([CHUNK - 1, 12]);
  const t = new EventTarget();
  const got: string[] = [];
  attachPaste(t, (s) => got.push(s), () => false);
  paste(t, text);
  while (got.join("").length < CHUNK + 10) await new Promise((r) => setTimeout(r, 0));
  expect(got.map((c) => c.length)).toEqual([CHUNK - 1, 11]);
  expect(got.join("")).toBe("a".repeat(CHUNK - 1) + "\r" + "b".repeat(10));
});

test("an emoji straddling the cut is not split into two broken halves", () => {
  const text = "a".repeat(CHUNK - 1) + "\u{1F600}" + "b";
  const chunks = cutChunks(text);
  expect(chunks.map((c) => c.length)).toEqual([CHUNK - 1, 3]);
  expect(chunks[1]).toBe("\u{1F600}b");
  expect(chunks.join("")).toBe(text);
  expect(cutChunks("\u{1F600}\u{1F601}", 2)).toEqual(["\u{1F600}", "\u{1F601}"]);
});

test("a 3-chunk paste into a program with bracketed paste on gets exactly one bracket pair, each chunk after the last one landed", async () => {
  const t = new EventTarget();
  const got: string[] = [];
  let release: (() => void)[] = [];
  attachPaste(
    t,
    (s) => {
      got.push(s);
      return new Promise<void>((r) => release.push(r));
    },
    () => false,
    () => {},
    () => true,
  );
  paste(t, "x".repeat(2 * CHUNK + 5));
  expect(got).toHaveLength(1);
  expect(got[0]).toBe(BRACKET_OPEN + "x".repeat(CHUNK));
  await new Promise((r) => setTimeout(r, 0));
  expect(got).toHaveLength(1); // the second chunk waits for the first write to land
  release.shift()?.();
  await new Promise((r) => setTimeout(r, 0));
  expect(got).toHaveLength(2);
  release.shift()?.();
  await new Promise((r) => setTimeout(r, 0));
  expect(got).toHaveLength(3);
  expect(got[2]).toBe("xxxxx" + BRACKET_CLOSE);
  const all = got.join("");
  expect(all.split(BRACKET_OPEN)).toHaveLength(2);
  expect(all.split(BRACKET_CLOSE)).toHaveLength(2);
  expect(all).toBe(BRACKET_OPEN + "x".repeat(2 * CHUNK + 5) + BRACKET_CLOSE);
  release = [];
});

test("cancel mid-paste drops the queued remainder and closes the open bracket; nothing more goes afterwards", async () => {
  const t = new EventTarget();
  const got: string[] = [];
  const release: (() => void)[] = [];
  const p = attachPaste(
    t,
    (s) => {
      got.push(s);
      return new Promise<void>((r) => release.push(r));
    },
    () => false,
    () => {},
    () => true,
  );
  paste(t, "y".repeat(3 * CHUNK));
  expect(got).toHaveLength(1);
  p.cancel();
  expect(got).toEqual([BRACKET_OPEN + "y".repeat(CHUNK), BRACKET_CLOSE]);
  release.forEach((r) => r());
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  expect(got).toHaveLength(2);
  p.cancel(); // nothing open: no second close
  expect(got).toHaveLength(2);
  paste(t, "z"); // the pane takes the next paste normally
  expect(got[2]).toBe(BRACKET_OPEN + "z" + BRACKET_CLOSE);
});

// Council D2 MERGE 32 AFTER A1 (T-278-d): a clipboard that holds a fake close bracket must not end the
// bracket early and type what follows straight into the shell. Every ESC byte is dropped from a
// bracketed paste, so the program sees exactly one bracket pair and plain text inside it.
test("a bracketed paste holding a fake close bracket and a command arrives inside one bracket pair with no bare ESC", () => {
  const t = new EventTarget();
  const got: string[] = [];
  attachPaste(t, (s) => got.push(s), () => false, () => {}, () => true);
  paste(t, "echo hi" + BRACKET_CLOSE + "rm -rf x\n" + BRACKET_OPEN + "\x1b[31mred");
  const all = got.join("");
  expect(all.startsWith(BRACKET_OPEN)).toBe(true);
  expect(all.endsWith(BRACKET_CLOSE)).toBe(true);
  const inside = all.slice(BRACKET_OPEN.length, all.length - BRACKET_CLOSE.length);
  expect(inside).not.toContain("\x1b");
  expect(inside).toBe("echo hi[201~rm -rf x\r[200~[31mred");
  expect(all.split("\x1b")).toHaveLength(3); // the opening and the closing bracket, nothing else
  expect(prepareForTerminal("a\x1bb\r\nc", true)).toBe("ab\rc");
  expect(prepareForTerminal("a\x1bb\r\nc")).toBe("a\x1bb\rc"); // an unbracketed paste keeps its bytes
});

test("council D2 MERGE 47 FB2: a right-click paste goes through the same checks and asks", () => {
  const t = new EventTarget();
  const got: string[] = [];
  let asked: { lines: number; go: () => void } | null = null;
  const p = attachPaste(t, (s) => got.push(s), () => false, () => {}, () => false, () => false, (lines, go) => (asked = { lines, go }));
  p.paste("a\nb");
  expect(asked).toEqual({ lines: 2, go: expect.any(Function) });
  expect(got).toEqual([]);
  p.paste("x\n");
  expect(got).toEqual(["x"]);
  p.detach();
});

// T-605 re-review of PR #15: an agent's typed prompt goes in as one bracketed paste with ESC and every
// control character except line feed and tab dropped, so it cannot end the paste early.
test("a typed prompt cannot end its bracketed paste early or press Enter", () => {
  expect(bracketed("Fix: title\x1b[201~\rrm -rf ~\r\nnext\tline\x07\x9b2J")).toBe("\x1b[200~Fix: title[201~rm -rf ~\nnext\tline2J\x1b[201~");
});
