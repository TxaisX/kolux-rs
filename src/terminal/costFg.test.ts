import { expect, test } from "vitest";
import { buildTheme, classic, readAppearance, themeVars } from "../theme";

// Stand-in review of lane/marks b08c624c, FIX-SOON 4: the cost chip's colour is a theme token, not a
// literal that every theme shares.
test("USAGE-034: --cost-fg is a theme token in dark and light, darker on the light ground", () => {
  const a = readAppearance({});
  const dark = buildTheme(a, true);
  const light = buildTheme(a, false);
  expect(dark["cost-fg"]).toBe("#1f9db0");
  expect(light["cost-fg"]).toMatch(/^#[0-9a-f]{6}$/i);
  expect(light["cost-fg"]).not.toBe(dark["cost-fg"]);
  expect(themeVars(dark)["--cost-fg"]).toBe(classic["cost-fg"]);
});
