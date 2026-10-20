import { expect, test } from "vitest";
import { followStep } from "./logFollow";

test("EDIT-026: lines appended to the log show; nothing new shows nothing", () => {
  expect(followStep("a\n", "a\nb\nc\n")).toEqual({ text: "a\nb\nc\n", reset: false });
  expect(followStep("a\nb\n", "a\nb\n")).toBeNull();
});

test("EDIT-026: a partly written line is held back until it is complete", () => {
  expect(followStep("a\n", "a\nb")).toBeNull();
  expect(followStep("a\n", "a\nb\nc")).toEqual({ text: "a\nb\n", reset: false });
  expect(followStep("a\n", "a\nb\n")).toEqual({ text: "a\nb\n", reset: false });
});

test("EDIT-026: an emptied, rotated or cut log starts again from the top", () => {
  expect(followStep("a\nb\n", "")).toEqual({ text: "", reset: true });
  expect(followStep("a\nb\n", "x\n")).toEqual({ text: "x\n", reset: true });
  expect(followStep("a\nb\n", "a\n")).toEqual({ text: "a\n", reset: true });
  expect(followStep("", "")).toBeNull();
});
