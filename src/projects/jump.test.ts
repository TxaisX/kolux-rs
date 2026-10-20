import { expect, test } from "vitest";
import { fadeIfIdle, filtersToClear, FLICK_SPEED, IDLE_MS, nextTopButton, strongUpwardFlick, topButtonAllowed, whenRowDrawn } from "./jump";

const long = { scrollTop: 3000, scrollHeight: 6000, clientHeight: 800 };
const off = { shown: false, idleSince: 0 };

test("only a strong upward flick counts", () => {
  expect(strongUpwardFlick(-600, 100)).toBe(true);
  expect(strongUpwardFlick(-100, 100)).toBe(false);
  expect(strongUpwardFlick(600, 100)).toBe(false);
  expect(strongUpwardFlick(-FLICK_SPEED, 1000)).toBe(true);
  expect(strongUpwardFlick(-500, 0)).toBe(false);
});

test("in a short list, flicking upward shows no scroll-to-top button", () => {
  const short = { scrollTop: 400, scrollHeight: 1400, clientHeight: 800 };
  expect(topButtonAllowed(short)).toBe(false);
  expect(nextTopButton(off, short, true, 10).shown).toBe(false);
});

test("near the top of a long list the button does not show either", () => {
  const near = { scrollTop: 200, scrollHeight: 6000, clientHeight: 800 };
  expect(nextTopButton(off, near, true, 10).shown).toBe(false);
});

test("a strong flick far down a long list shows the button, a gentle scroll does not, and idle fades it", () => {
  expect(nextTopButton(off, long, false, 10).shown).toBe(false);
  const on = nextTopButton(off, long, true, 100);
  expect(on).toEqual({ shown: true, idleSince: 100 });
  expect(nextTopButton(on, long, false, 200)).toBe(on);
  expect(fadeIfIdle(on, 100 + IDLE_MS - 1)).toBe(on);
  expect(fadeIfIdle(on, 100 + IDLE_MS).shown).toBe(false);
  // scrolling back up to the top hides it at once
  expect(nextTopButton(on, { ...long, scrollTop: 100 }, false, 150).shown).toBe(false);
});

test("revealing the current workspace names exactly the filters that were hiding it", () => {
  const filters = [
    { key: "hideAutomationWorktrees", hides: (p: string) => p.includes("auto") },
    { key: "showSleeping", hides: (p: string) => p.includes("asleep") },
    { key: "search", hides: (p: string) => !p.includes("api") },
  ];
  expect(filtersToClear("C:/ws/auto-asleep", filters)).toEqual(["hideAutomationWorktrees", "showSleeping", "search"]);
  expect(filtersToClear("C:/ws/api", filters)).toEqual([]);
  expect(filtersToClear(null, filters)).toEqual([]);
});

test("a row not drawn yet is waited for, then scrolled to once", async () => {
  let calls = 0;
  const shown: string[] = [];
  const waited: number[] = [];
  const ok = await whenRowDrawn(
    () => (++calls >= 4 ? "row" : null),
    (r) => void shown.push(r),
    async (ms) => void waited.push(ms),
  );
  expect(ok).toBe(true);
  expect(shown).toEqual(["row"]);
  expect(waited).toEqual([50, 50, 50]);
});

test("a row that never appears is given up on after the tries", async () => {
  const waited: number[] = [];
  const ok = await whenRowDrawn(() => null, () => {}, async (ms) => void waited.push(ms), 5, 10);
  expect(ok).toBe(false);
  expect(waited.length).toBe(5);
});
