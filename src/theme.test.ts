import design from "../design/DESIGN.md?raw";
import { expect, test } from "vitest";
import { applyTheme, classic, coreTokens, terminalTheme } from "./theme";

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
