import { expect, test } from "vitest";
import { readLook, savedFirst, stampLook, startScreen } from "./general";

test("a fresh profile is New, an existing one without the choice is Classic", () => {
  expect(readLook({})).toBe("new");
  expect(readLook({ defaultAgent: "claude" })).toBe("classic");
  expect(readLook({ defaultAgent: "claude", uiLook: "new" })).toBe("new");
  expect(readLook({ uiLook: "fancy", x: 1 })).toBe("classic");
});

test("the look is written down once, so a fresh profile stays New", () => {
  expect(stampLook({})).toEqual({ uiLook: "new" });
  expect(stampLook({ a: 1 })).toEqual({ a: 1, uiLook: "classic" });
  expect(stampLook({ uiLook: "new" })).toBeNull();
});

test("the first screen counts only under New", () => {
  expect(startScreen({ uiLook: "new", firstScreen: "board" })).toBe("board");
  expect(startScreen({ uiLook: "classic", firstScreen: "board" })).toBe("terminals");
  expect(savedFirst({ firstScreen: "elsewhere" })).toBe("terminals");
});
