import { expect, test } from "vitest";
import { appearanceVars, FIELD, readAppearance, terminalFor, writeAppearance } from "../theme";
import { DEFAULT_TINT, MAX_WASH, sidebarBackground, sidebarLookOf } from "./sidebar";

const vars = (s: Record<string, unknown>, dark = true) => appearanceVars(readAppearance(s), dark)["--sidebar-bg"];

test("VIEW-052: nothing saved, or an unknown look, leaves the sidebar on the standard surface", () => {
  expect(vars({})).toBe("var(--surface)");
  expect(vars({ [FIELD.sidebarLook]: "plaid" })).toBe("var(--surface)");
  expect(vars({ [FIELD.sidebarLook]: "standard", [FIELD.sidebarTint]: "#ff0000", [FIELD.sidebarStrength]: 90 }), "a saved tint does nothing in Standard").toBe("var(--surface)");
  expect(sidebarLookOf(undefined)).toBe("standard");
});

test("VIEW-052: Tinted at 50 % lays half of the wash over the surface; 0 % is the surface itself", () => {
  const half = vars({ [FIELD.sidebarLook]: "tinted", [FIELD.sidebarTint]: "#ff0000", [FIELD.sidebarStrength]: 50 });
  // Classic dark surface is #171717 (23): 23 + (255 - 23) * 0.5 * MAX_WASH
  expect(half).toBe("#" + [Math.round(23 + 232 * 0.5 * MAX_WASH), Math.round(23 - 23 * 0.5 * MAX_WASH), Math.round(23 - 23 * 0.5 * MAX_WASH)].map((v) => v.toString(16).padStart(2, "0")).join(""));
  expect(vars({ [FIELD.sidebarLook]: "tinted", [FIELD.sidebarTint]: "#ff0000", [FIELD.sidebarStrength]: 0 })).toBe("#171717");
  const faint = vars({ [FIELD.sidebarLook]: "tinted", [FIELD.sidebarTint]: "#ff0000", [FIELD.sidebarStrength]: 10 }) as string;
  expect(parseInt(faint.slice(1, 3), 16), "red at low strength: a faint wash").toBeGreaterThan(23);
  expect(parseInt(faint.slice(1, 3), 16)).toBeLessThan(parseInt(half!.slice(1, 3), 16));
});

test("VIEW-052: strength is pulled into 0 to 100; a bad tint falls back to the default blue; 100 % never fully covers the surface", () => {
  const a = readAppearance({ [FIELD.sidebarLook]: "tinted", [FIELD.sidebarTint]: "red;}", [FIELD.sidebarStrength]: 900 });
  expect([a.sidebarTint, a.sidebarStrength]).toEqual([DEFAULT_TINT, 100]);
  expect(readAppearance({ [FIELD.sidebarStrength]: -5 }).sidebarStrength).toBe(0);
  expect(readAppearance({}).sidebarStrength).toBe(20);
  const full = sidebarBackground("tinted", "#ffffff", 100, "#171717", undefined);
  expect(full).not.toBe("#ffffff");
  expect(sidebarBackground("tinted", "#ffffff", 500, "#171717", undefined), "past 100 counts as 100").toBe(full);
});

test("SET-021: Match terminal paints the terminal's own background, in dark and in light mode", () => {
  const s = { [FIELD.sidebarLook]: "terminal" };
  expect(vars(s)).toBe(terminalFor(readAppearance(s), true).background);
  expect(vars(s, false)).toBe(terminalFor(readAppearance(s), false).background);
  expect(vars({ ...s, terminalScheme: "match", appTheme: "violet" })).toBe(terminalFor(readAppearance({ ...s, terminalScheme: "match", appTheme: "violet" }), true).background);
  expect(sidebarBackground("terminal", DEFAULT_TINT, 20, "#171717", "rgba(0,0,0,0.5)"), "a colour it cannot mix falls back to Standard").toBe("var(--surface)");
});

test("the sidebar look round-trips through the saved settings and keeps other settings", () => {
  const a = readAppearance({ [FIELD.sidebarLook]: "tinted", [FIELD.sidebarTint]: "#AA3300", [FIELD.sidebarStrength]: 33.6 });
  expect(a).toMatchObject({ sidebarLook: "tinted", sidebarTint: "#aa3300", sidebarStrength: 34 });
  expect(writeAppearance({ other: 1 }, a)).toMatchObject({ other: 1, sidebarLook: "tinted", sidebarTint: "#aa3300", sidebarTintStrength: 34 });
});
