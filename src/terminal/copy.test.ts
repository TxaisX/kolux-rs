// TERM-065 (T-067): copying the selection never lies about what happened, pure so it runs without a browser.
import { expect, test } from "vitest";
import { copySelection } from "./copy";

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
