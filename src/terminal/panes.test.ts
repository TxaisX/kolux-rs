import { expect, test } from "vitest";
import { appearanceVars, readAppearance, writeAppearance } from "../theme";

// SET-023 (T-148-d): divider width and colour per mode, and the dim of panes not in focus.
test("pane look defaults keep DESIGN.md: 6 px gap, no colour, no dim", () => {
  const a = readAppearance({});
  expect([a.dividerWidth, a.dividerDark, a.dividerLight, a.paneDim]).toEqual([6, "", "", 100]);
  expect(appearanceVars(a, true)).toMatchObject({ "--divider-width": "6px", "--divider": "transparent", "--pane-dim": "1" });
});

test("pane look is clamped, colours must be #rrggbb, and the colour follows the mode", () => {
  const a = readAppearance({ paneDividerWidth: 50, paneDim: 5, paneDividerDark: "#AA3300", paneDividerLight: "red;}" });
  expect([a.dividerWidth, a.paneDim, a.dividerDark, a.dividerLight]).toEqual([12, 30, "#aa3300", ""]);
  expect(readAppearance({ paneDividerWidth: 1 }).dividerWidth).toBe(2);
  expect(appearanceVars(a, true)).toMatchObject({ "--divider": "#aa3300", "--pane-dim": "0.3", "--divider-width": "12px" });
  expect(appearanceVars(readAppearance({ paneDividerLight: "#ffffff" }), false)["--divider"]).toBe("#ffffff");
  expect(writeAppearance({}, a)).toMatchObject({ paneDividerWidth: 12, paneDim: 30, paneDividerDark: "#aa3300", paneDividerLight: "" });
});

// The CSS side (gap, colour, 140 ms fade) is checked live: vitest loads stylesheets empty.
