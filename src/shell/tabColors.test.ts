import { describe, expect, it } from "vitest";
import { colorOf, setTabColor, tabStyle, TAB_COLORS } from "../terminal/tabColor";

describe("TERM-133 colour-code a tab", () => {
  it("offers ten choices in the card order: none, then nine colours", () => {
    expect(TAB_COLORS.map((c) => c.id)).toEqual(["blue", "purple", "pink", "red", "orange", "yellow", "green", "teal", "grey"]);
    expect(new Set(TAB_COLORS.map((c) => c.css)).size).toBe(9);
  });
  it("Green puts a dot on that tab only; None takes it away", () => {
    const green = setTabColor({}, 7, "green");
    expect(tabStyle(green, 7)).toEqual({ "--tab-dot": TAB_COLORS.find((c) => c.id === "green")!.css });
    expect(tabStyle(green, 8)).toBeUndefined();
    const none = setTabColor(green, 7, null);
    expect(tabStyle(none, 7)).toBeUndefined();
    expect(colorOf(none, 7)).toBeNull();
  });
  it("the dot never touches the terminal's own colours", () => {
    const s = tabStyle({ 1: "grey" }, 1) as Record<string, string>;
    expect(Object.keys(s)).toEqual(["--tab-dot"]);
  });
});
