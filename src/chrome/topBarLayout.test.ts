// T-621: the screen switcher fits its four segments and the top bar's right group never covers it, from the
// 900 px minimum to 1920 px. The geometry itself is proved in a real browser (evidence/T-621.txt, Chromium with the
// app's font); this guards the stylesheet rules that proof depends on, so a later edit cannot quietly undo them.
import { expect, test } from "vitest";

// Vitest returns "" for a .css import, so the stylesheet is read from disk (the project carries no Node types).
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const css = nodeFs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
/** The declarations of the first rule whose selector is exactly `sel`, at the top level or inside `media`. */
const rule = (sel: string, media?: string): string => {
  const scope = media ? css.slice(css.indexOf(media), css.indexOf("\n}", css.indexOf(media))) : css;
  const esc = sel.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
  const m = scope.match(new RegExp(`(?:^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`));
  expect(m, `${sel} ${media ?? ""}`).not.toBeNull();
  return m![1];
};

test("T-621: the switcher's frame takes its segments' width, never a fixed one", () => {
  const s = rule(".switcher");
  expect(s).not.toMatch(/(^|;)\s*width:\s*\d+px/);
  expect(s).toMatch(/width:\s*max-content/);
});

test("T-621: while the bar fits centred, neither side column is narrower than its content", () => {
  expect(rule(".topbar")).toMatch(/grid-template-columns:\s*minmax\(max-content, 1fr\) auto minmax\(max-content, 1fr\)/);
});

test("T-621: below 1366 px the switcher follows the left group, and the right group stays inside its column, its pills shortening", () => {
  const media = "@media (max-width: 1365px)";
  expect(rule(".topbar", media)).toMatch(/grid-template-columns:\s*max-content auto minmax\(0, 1fr\)/);
  const right = rule(".topbar-right", media);
  expect(right).toMatch(/max-width:\s*100%/);
  expect(right).toMatch(/overflow:\s*hidden/);
  expect(rule(".topbar-right > .acct-switch", media)).toMatch(/flex-shrink:\s*1/);
  expect(rule(".topbar-right > .usage", media)).toMatch(/flex-shrink:\s*1/);
});
