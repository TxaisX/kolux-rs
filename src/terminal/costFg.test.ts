import { expect, test } from "vitest";
import { buildTheme, classic, hsl, readAppearance, themeVars } from "../theme";

// Stand-in review of lane/marks b08c624c, FIX-SOON 4: the cost chip's colour is a theme token, not a
// literal that every theme shares. Review of 2d4235af, AFTER 1: the light value must actually be darker.
const lightness = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
};

/** Hex to [hue, saturation, lightness], the same conversion the theme code uses. */
const toHsl = (hex: string): [number, number, number] => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
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
  // exactly the dark colour with its lightness cut to three quarters (review AFTER 2: no loose tolerance)
  const [h, s, l] = toHsl(dark["cost-fg"]);
  expect(light["cost-fg"]).toBe(hsl(h, s, l * 0.75));
  expect(themeVars(dark)["--cost-fg"]).toBe(classic["cost-fg"]);
});
