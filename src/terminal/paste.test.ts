// TERM-068: a paste lands only in the pane whose text area received it, and a paste made while the
// opening prompt is still owed waits for it (T-010-fix). Node's EventTarget stands in for the text areas.
import { expect, test } from "vitest";
import { attachPaste } from "./paste";

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
