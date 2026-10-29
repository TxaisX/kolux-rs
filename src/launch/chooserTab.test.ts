// T-577: a chooser pane's tab reads "New session" until something starts in it.
import { expect, test } from "vitest";
import { CHOOSER_TAB, chooserTabName } from "./chooserTab";
import { emptySeat } from "./seats";

test("a chooser pane is called New session", () => {
  expect(CHOOSER_TAB).toBe("New session");
  expect(chooserTabName({ seats: [emptySeat()] })).toBe("New session");
  expect(chooserTabName({ seats: [emptySeat()], title: "  " })).toBe("New session");
});

test("a started pane (no seats) keeps its usual name", () => {
  expect(chooserTabName({})).toBeNull();
  expect(chooserTabName({ title: "Build" })).toBeNull();
});

test("a name the user gave the chooser tab wins", () => {
  expect(chooserTabName({ seats: [emptySeat()], title: "Review" })).toBe("Review");
});
