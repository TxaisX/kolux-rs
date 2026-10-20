import { beforeEach, expect, test, vi } from "vitest";
import { FINISH_DEBOUNCE_MS, finished, onFinish, resetFinished, wantsRefresh } from "./finished";

beforeEach(() => resetFinished());

test("the same finish reported twice tells the poll once (STAT-038)", () => {
  const told = vi.fn();
  const off = onFinish(told);
  expect(finished(4, "C:/w/a", 1000)).toBe(true);
  expect(finished(4, "C:/w/a", 1000 + 2000)).toBe(false);
  expect(told).toHaveBeenCalledTimes(1);
  expect(told).toHaveBeenCalledWith("C:/w/a");
  // A later finish of the same pane, and another pane's, are finishes of their own.
  expect(finished(4, "C:/w/a", 1000 + FINISH_DEBOUNCE_MS)).toBe(true);
  expect(finished(5, "C:/w/b", 1500)).toBe(true);
  expect(told).toHaveBeenCalledTimes(3);
  off();
  expect(finished(6, "C:/w/c", 99_000)).toBe(true);
  expect(told).toHaveBeenCalledTimes(3); // unsubscribed
});

test("a finish with no folder tells nobody (STAT-038)", () => {
  const told = vi.fn();
  onFinish(told);
  expect(finished(1, null)).toBe(false);
  expect(told).not.toHaveBeenCalled();
});

test("the early round is skipped when the window is hidden, the folder is not listed or a rate limit runs (STAT-038)", () => {
  const base = { hidden: false, paths: ["C:\\Work\\App\\","C:/Work/Other"], cwd: "c:/work/app", limitedUntil: 0, now: 1_000_000 };
  expect(wantsRefresh(base)).toBe(true); // slashes, case and a trailing slash do not matter
  expect(wantsRefresh({ ...base, hidden: true })).toBe(false);
  expect(wantsRefresh({ ...base, cwd: "C:/Work/Unlisted" })).toBe(false);
  expect(wantsRefresh({ ...base, limitedUntil: 2_000 })).toBe(false); // lifts at 2000 s = 2,000,000 ms
  expect(wantsRefresh({ ...base, limitedUntil: 500 })).toBe(true); // already lifted
});
