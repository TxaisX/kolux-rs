// TERM-068: a paste lands only in the pane whose text area received it, and a paste made while the
// opening prompt is still owed waits for it (T-010-fix). Node's EventTarget stands in for the text areas.
import { expect, test } from "vitest";
import { attachPaste, CHUNK, LIMIT } from "./paste";

const paste = (target: EventTarget, text: string) => {
  const e = Object.assign(new Event("paste", { cancelable: true }), { clipboardData: { getData: () => text } });
  target.dispatchEvent(e);
  return e;
};

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
