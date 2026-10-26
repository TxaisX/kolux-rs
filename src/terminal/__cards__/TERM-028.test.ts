// TERM-028 acceptance box 1: a new install lands on the clean (New) look, whose grid is rounded session windows with gaps.
// The look comes from the real readLook / stampLook; the rounding and gaps are the grid's real stylesheet rules (the grid
// only gets the `classic` class under the Classic look, App.tsx grid className).
import { expect, test } from "vitest";
import { readLook, stampLook } from "../../settings/general";
import { readAppearance } from "../../theme";

const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const css = nodeFs.readFileSync(new URL("../../styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (selector: string): string[] =>
  [...css.matchAll(/(^|\n)([^{}\n][^{}]*)\{([^}]*)\}/g)].filter((m) => m[2].split(",").map((s) => s.trim()).includes(selector)).map((m) => m[3]);

test("box 1: a profile with no settings lands on the New look, which stays New once settings are saved", () => {
  expect(readLook({})).toBe("new");
  const stamped = stampLook({});
  expect(stamped).toMatchObject({ uiLook: "new" });
  expect(readLook({ ...stamped, somethingElse: 1 })).toBe("new");
  // existing profiles keep what they had: settings without a saved look stay Classic
  expect(readLook({ someOldSetting: true })).toBe("classic");
  expect(readLook({ uiLook: "classic" })).toBe("classic");
});

test("box 1: the clean grid is rounded windows with gaps; only .classic squares them off and removes the gap margin", () => {
  const grid = rule(".grid").join(";");
  expect(grid).toMatch(/border-radius:\s*14px/);
  expect(grid).toMatch(/margin:\s*8px/);
  expect(grid).toMatch(/gap:\s*var\(--divider-width,\s*6px\)/);
  // the session window: the later .pane rule rounds it at 14 px, with a visible border
  const radii = [...rule(".pane").join(";").matchAll(/border-radius:\s*([^;]+)/g)].map((m) => m[1].trim());
  expect(radii[radii.length - 1]).toBe("14px");
  // a new install's gap is the default divider width: a real, non-zero number of pixels
  expect(readAppearance({}).dividerWidth).toBe(6);
  expect(readAppearance({}).dividerWidth).toBeGreaterThan(0);
  // Classic is what squares them: both rules name the classic class
  expect(css).toMatch(/\.grid\.classic \.pane\s*\{\s*border-radius:\s*0/);
});
