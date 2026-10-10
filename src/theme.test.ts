import design from "../design/DESIGN.md?raw";
import { expect, test } from "vitest";
import { applyTheme, buildTheme, classic, coreTokens, previewOf, readAppearance, terminalFor, terminalTheme, themeVars, THEMES, writeAppearance } from "./theme";

/** The `| \`--token\` | \`#hex\` |` rows of DESIGN.md section 2, as a name-to-hex map. */
function designPalette(): Record<string, string> {
  const text = design;
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/^\| `--([a-z-]+)` \| `(#[0-9a-f]{6})` \|/gm)) out[m[1]] = m[2];
  return out;
}

test("the ten core colours are the ones measured in DESIGN.md", () => {
  const measured = designPalette();
  expect(Object.keys(measured).length).toBeGreaterThanOrEqual(10);
  for (const name of coreTokens) expect(`${name}=${classic[name]}`).toBe(`${name}=${measured[name]}`);
});

test("tokens land on the root as custom properties, fonts included", () => {
  const set: Record<string, string> = {};
  applyTheme({ style: { setProperty: (n, v) => (set[n] = v) } });
  expect(set["--surface"]).toBe("#171717");
  expect(set["--ui-font"]).toContain("Segoe UI");
  expect(set["--mono-font"]).toContain("Cascadia Mono");
});

test("the terminal body uses the pane colours", () => {
  expect(terminalTheme()).toMatchObject({ background: "#0d0d0d", foreground: "#fafafa" });
});

const look = (o: Record<string, unknown> = {}) => readAppearance(o);
const grey = (hex: string) => hex.slice(1, 3) === hex.slice(3, 5) && hex.slice(3, 5) === hex.slice(5, 7);

test("Classic comes first, then the 16 hues in colour-wheel order", () => {
  expect(THEMES.join(" ")).toBe("classic ember copper sand moss fern jade teal lagoon sky cobalt indigo iris violet orchid rose graphite");
});

test("an absent or unknown theme is Classic, loading and saving", () => {
  expect(look().theme).toBe("classic");
  expect(look({ appTheme: "Neon" }).theme).toBe("classic");
  expect(look({ appTheme: "Teal" }).theme).toBe("teal");
  expect(writeAppearance({ other: 1 }, { ...look(), theme: "neon" as never })).toMatchObject({ other: 1, appTheme: "classic" });
  expect(buildTheme(look())).toEqual(classic);
});

test("sliders are pulled into their spans and words fall back to the default", () => {
  expect(look({ themeSaturation: 500 }).saturation).toBe(160);
  expect(look({ themeSaturation: "lots" }).saturation).toBe(100);
  expect(look({ themeTint: -999, themeDepth: 9 })).toMatchObject({ tint: -180, depth: 6 });
  expect(look({ themeDepth: "2" }).depth).toBe(2);
});

test("a hue recolours the greys but not the status colours", () => {
  const teal = buildTheme(look({ appTheme: "teal" }));
  expect(teal.surface).not.toBe(classic.surface);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(teal.surface.slice(i, i + 2), 16));
  expect(g > r && b > r).toBe(true); // teal: green and blue over red
  expect(teal.done).toBe(classic.done);
  expect(teal.working).toBe(classic.working);
});

test("saturation 0 or Graphite is greyscale; depth makes backgrounds lighter or darker", () => {
  expect(grey(buildTheme(look({ appTheme: "moss", themeSaturation: 0 })).surface)).toBe(true);
  expect(grey(buildTheme(look({ appTheme: "moss" })).surface)).toBe(false);
  expect(grey(buildTheme(look({ appTheme: "graphite" })).surface)).toBe(true);
  const at = (d: number) => parseInt(buildTheme(look({ appTheme: "sky", themeDepth: d }))["app-bg"].slice(1, 3), 16) + parseInt(buildTheme(look({ appTheme: "sky", themeDepth: d }))["app-bg"].slice(5, 7), 16);
  expect(at(6)).toBeGreaterThan(at(0));
  expect(at(-3)).toBeLessThanOrEqual(at(0));
});

test("the preview shows violet while Classic is chosen", () => {
  expect(previewOf(look()).theme).toBe("violet");
  expect(previewOf(look({ appTheme: "rose" })).theme).toBe("rose");
  expect(themeVars(buildTheme(look()))["--surface"]).toBe("#171717");
});

test("terminal colours follow the app hue only on Match", () => {
  expect(terminalFor(look({ appTheme: "sky" }))).toMatchObject({ background: "#0d0d0d", foreground: "#fafafa" });
  const sky = terminalFor(look({ appTheme: "sky", terminalScheme: "match" }));
  const ember = terminalFor(look({ appTheme: "ember", terminalScheme: "match" }));
  expect(sky.background).toBe(buildTheme(look({ appTheme: "sky" }))["pane-bg"]);
  expect(sky.background).not.toBe(ember.background);
  expect(sky.blue).not.toBe(ember.blue);
  expect(Object.keys(sky)).toEqual(expect.arrayContaining(["black", "red", "brightCyan", "brightWhite"]));
});
