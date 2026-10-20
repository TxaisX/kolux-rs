import { expect, test } from "vitest";
import { currentSeed, seedSources, seedText } from "./searchSeed";

test("EDIT-038: a caret on a function name seeds the name", () => {
  const doc = "const run_it = () => foo(bar);";
  expect(seedText(doc, 17, 17)).toBe("");
  expect(seedText(doc, 8, 8)).toBe("run_it");
  expect(seedText(doc, 6, 6)).toBe("run_it"); // at the start of the word
  expect(seedText(doc, 12, 12)).toBe("run_it"); // at its end
  expect(seedText(doc, 25, 25)).toBe("bar");
});

test("EDIT-038: a selection over three lines becomes one line", () => {
  const doc = "a\n  b  c\r\n\n  d\nz";
  expect(seedText(doc, 0, 14)).toBe("a b  c d");
  expect(seedText(doc, 14, 0)).toBe("a b  c d");
});

test("EDIT-038: the query is one short line and the tab in front answers", () => {
  expect(seedText("x".repeat(500), 0, 500).length).toBe(200);
  expect(currentSeed()).toBe("");
  seedSources.set(7, () => "seven");
  seedSources.set(8, () => "eight");
  seedSources.focus(7);
  expect(currentSeed()).toBe("seven");
  seedSources.focus(8);
  expect(currentSeed()).toBe("eight");
  seedSources.delete(8);
  expect(currentSeed()).toBe("");
  seedSources.delete(7);
});
