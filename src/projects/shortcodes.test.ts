import { describe, expect, it } from "vitest";
import { SHORTCODES, flagOf, shortcodeAt, shortcodeKey, suggest, withEmoji } from "./shortcodes";

describe("PROJ-061 :shortcodes: insert emoji", () => {
  it("finds the :word before the caret and nothing elsewhere", () => {
    expect(shortcodeAt("ship :fire", 10)).toEqual({ start: 5, query: "fire" });
    expect(shortcodeAt(":fire", 5)).toEqual({ start: 0, query: "fire" });
    expect(shortcodeAt("a:b", 3)).toBeNull();
    expect(shortcodeAt("ship :", 6)).toBeNull();
    expect(shortcodeAt("ship :fire tail", 5)).toBeNull();
    expect(shortcodeAt("time 10:30", 10)).toBeNull();
  });

  it("Enter on :fire inserts the emoji and keeps the text after the caret", () => {
    const at = shortcodeAt("do :fire later", 8)!;
    const pick = suggest(at.query)[0];
    expect(pick.emoji).toBe("\u{1F525}");
    expect(withEmoji("do :fire later", at.start, 8, pick.emoji)).toEqual({ text: "do \u{1F525} later", caret: 3 + pick.emoji.length });
    expect(shortcodeKey("Enter", false, true)).toBe("take");
  });

  it("Escape closes the list and leaves the typed text alone; a composing IME is never interrupted", () => {
    expect(shortcodeKey("Escape", false, true)).toBe("close");
    expect(shortcodeKey("Enter", true, true)).toBeNull();
    expect(shortcodeKey("Enter", false, false)).toBeNull();
    expect(shortcodeKey("ArrowDown", false, true)).toBe("down");
  });

  it("exact matches rank first, flags are found by country name or ISO code, and no skin tones are offered", () => {
    expect(suggest("star")[0].code).toBe("star");
    expect(suggest("fire")[0].code).toBe("fire");
    expect(suggest("japan")[0].emoji).toBe(flagOf("JP"));
    expect(suggest("jp")[0].emoji).toBe("\u{1F1EF}\u{1F1F5}");
    expect(suggest("united states")[0].emoji).toBe(flagOf("US"));
    expect(suggest("zzzzz")).toEqual([]);
    expect(suggest("")).toEqual([]);
    expect(SHORTCODES.every((s) => !/[\u{1F3FB}-\u{1F3FF}]/u.test(s.emoji))).toBe(true);
    expect(suggest("a", 3)).toHaveLength(3);
  });
});
