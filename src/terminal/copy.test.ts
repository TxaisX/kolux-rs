// TERM-065 (T-067): copying the selection never lies about what happened, pure so it runs without a browser.
import { expect, test } from "vitest";
import { COPY_CAP, copySelection, tooBigNotice } from "./copy";

function fakeTerm(text: string) {
  return {
    focused: 0,
    cleared: 0,
    hasSelection: () => text.length > 0,
    getSelection: () => text,
    clearSelection() {
      this.cleared++;
    },
    focus() {
      this.focused++;
    },
  };
}

test("a selection goes to the clipboard and the pane keeps the keyboard", async () => {
  const term = fakeTerm("ls -la");
  const written: string[] = [];
  const out = await copySelection(term, async (t) => void written.push(t), () => {
    throw new Error("no notice on success");
  });
  expect(out).toBe("copied");
  expect(written).toEqual(["ls -la"]);
  expect(term.focused).toBe(1);
});

test("nothing selected is never reported as copied, and nothing is written", async () => {
  const term = fakeTerm("");
  let wrote = 0;
  let notices = 0;
  const out = await copySelection(term, async () => void wrote++, () => notices++);
  expect(out).toBe("empty");
  expect(wrote).toBe(0);
  expect(notices).toBe(0);
});

test("a locked clipboard keeps the selection and says so once, not on every retry", async () => {
  const term = fakeTerm("secret");
  const notices: string[] = [];
  let now = 10_000;
  const fail = async () => {
    throw new Error("clipboard busy");
  };
  const throttle = { lastNotice: 0 };
  expect(await copySelection(term, fail, (m) => notices.push(m), () => now, throttle)).toBe("failed");
  expect(await copySelection(term, fail, (m) => notices.push(m), () => now, throttle)).toBe("failed");
  expect(notices).toHaveLength(1);
  expect(notices[0]).toMatch(/clipboard/i);
  expect(term.cleared).toBe(0);
  expect(term.focused).toBe(2);
  now += 6_000;
  await copySelection(term, fail, (m) => notices.push(m), () => now, throttle);
  expect(notices).toHaveLength(2);
});

test("VIEW-110: a copy over the limit says so clearly, writes nothing and keeps the selection; one at the limit copies", async () => {
  const writes: string[] = [];
  const notices: string[] = [];
  let focused = 0;
  const sel = (text: string) => ({ hasSelection: () => true, getSelection: () => text, focus: () => void focused++ });
  const write = async (t: string) => void writes.push(t);
  expect(await copySelection(sel("x".repeat(11)), write, (m) => notices.push(m), Date.now, { lastNotice: 0 }, 10)).toBe("too-big");
  expect(writes).toEqual([]);
  expect(notices).toHaveLength(1);
  expect(focused).toBe(1);
  expect(await copySelection(sel("x".repeat(10)), write, (m) => notices.push(m), Date.now, { lastNotice: 0 }, 10)).toBe("copied");
  expect(writes).toEqual(["x".repeat(10)]);
  expect(tooBigNotice(12 * 1024 * 1024)).toBe("The selection is too big to copy (12.0 MB of text; the limit is 10.0 MB). Select less and copy again.");
  expect(COPY_CAP).toBe(10 * 1024 * 1024);
});
