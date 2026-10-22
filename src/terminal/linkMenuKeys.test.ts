import { expect, test } from "vitest";
import { menuStep } from "./LinkActionMenu";

// AFTER row 603 (T-307-b): the link menu is reachable by keyboard; arrows move between rows and wrap.
test("arrow keys, Home and End pick the row to focus next; anything else is left alone", () => {
  expect(menuStep(3, 0, "ArrowDown")).toBe(1);
  expect(menuStep(3, 2, "ArrowDown")).toBe(0);
  expect(menuStep(3, 0, "ArrowUp")).toBe(2);
  expect(menuStep(3, 1, "ArrowUp")).toBe(0);
  expect(menuStep(3, 1, "Home")).toBe(0);
  expect(menuStep(3, 0, "End")).toBe(2);
  expect(menuStep(3, -1, "ArrowDown")).toBe(0);
  expect(menuStep(3, -1, "ArrowUp")).toBe(2);
  expect(menuStep(3, 0, "a")).toBeNull();
  expect(menuStep(0, -1, "ArrowDown")).toBeNull();
});
