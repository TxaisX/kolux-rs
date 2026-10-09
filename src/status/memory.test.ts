import { expect, test } from "vitest";
import { formatMemory } from "./memory";

test("working set reads like the status bar: one decimal in MB", () => {
  expect(formatMemory(717.9 * 1024 * 1024)).toBe("717.9 MB");
  expect(formatMemory(0)).toBe("0.0 MB");
  expect(formatMemory(52_428_800)).toBe("50.0 MB");
});

test("past a gigabyte it switches unit; unknown shows a dash", () => {
  expect(formatMemory(1.5 * 1024 * 1024 * 1024)).toBe("1.50 GB");
  expect(formatMemory(null)).toBe("– MB");
  expect(formatMemory(-1)).toBe("– MB");
});
