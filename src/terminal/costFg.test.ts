import { expect, test } from "vitest";
import { buildTheme, classic, readAppearance, themeVars } from "../theme";

// Stand-in review of lane/marks b08c624c, FIX-SOON 4: the cost chip's colour is a theme token, not a
// literal that every theme shares. Review of 2d4235af, AFTER 1: the light value must actually be darker.
const lightness = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
};

test("USAGE-034: --cost-fg is a theme token in dark and light, darker on the light ground", () => {
  const a = readAppearance({});
  const dark = buildTheme(a, true);
  const light = buildTheme(a, false);
  expect(dark["cost-fg"]).toBe("#1f9db0");
  expect(light["cost-fg"]).toMatch(/^#[0-9a-f]{6}$/i);
  expect(light["cost-fg"]).not.toBe(dark["cost-fg"]);
  // A status colour in a light theme is the dark value at 75% lightness, so lightness must fall.
  expect(lightness(light["cost-fg"])).toBeLessThan(lightness(dark["cost-fg"]));
  expect(lightness(light["cost-fg"])).toBeCloseTo(lightness(dark["cost-fg"]) * 0.75, 1);
  expect(themeVars(dark)["--cost-fg"]).toBe(classic["cost-fg"]);
});
