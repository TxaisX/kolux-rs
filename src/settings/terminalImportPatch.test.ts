// TERM-099 (T-307): what saving a Ghostty import writes, and which theme files the page asks for.
import { describe, expect, it } from "vitest";
import { ghosttyThemeNames, importGhostty, MAX_CUSTOM, type GhosttyFileIn } from "./importSchemes";
import { ghosttyPatch, hasChanges } from "./terminalImportRead";

const file = (text: string): GhosttyFileIn => ({ label: "config", text });
const THEMES: Record<string, string> = { Day: "background = ffffff\nforeground = 000000\n", Night: "background = 000000\nforeground = ffffff\n" };
const read = (n: string) => THEMES[n] ?? null;
const scheme = (name: string) => ({ name, background: "#000000", foreground: "#ffffff" });

describe("ghosttyThemeNames", () => {
  it("asks for the last theme line's dark and light names only, across files", () => {
    expect(ghosttyThemeNames([file("theme = Old\n"), file("theme = light:Day,dark:Night\n")])).toEqual(["Night", "Day"]);
    expect(ghosttyThemeNames([file("theme = Night\nfont-size = 12\n")])).toEqual(["Night"]);
    expect(ghosttyThemeNames([file("font-size = 12\n"), { label: "x", skipped: "could not be read" }])).toEqual([]);
  });
});

describe("ghosttyPatch", () => {
  it("writes the settings, joins the schemes, and picks the dark one for the terminal and the light one for light mode", () => {
    const r = importGhostty([file("font-size = 14\ntheme = light:Day,dark:Night\n")], read);
    const { patch, plan } = ghosttyPatch([scheme("Mine") as never], r);
    expect(plan.added).toEqual(["Night", "Day"]);
    expect(patch).toMatchObject({ terminalFontSize: 14, terminalScheme: "custom:Night", terminalSchemeLight: "custom:Day" });
    expect((patch.terminalCustomSchemes as Array<{ name: string }>).map((s) => s.name)).toEqual(["Mine", "Night", "Day"]);
    expect(hasChanges(r)).toBe(true);
  });

  it("a scheme refused at the cap is not chosen, and settings alone leave the schemes untouched", () => {
    const full = Array.from({ length: MAX_CUSTOM }, (_, i) => scheme(`S${i}`) as never);
    const r = importGhostty([file("theme = Night\ncursor-style = bar\n")], read);
    const { patch, plan } = ghosttyPatch(full, r);
    expect(plan.refused).toEqual(["Night"]);
    expect(patch).toEqual({ terminalCursorStyle: "bar" });
    const plain = ghosttyPatch(full, importGhostty([file("font-size = 12\n")], read));
    expect(plain.patch).toEqual({ terminalFontSize: 12 });
    expect(hasChanges(importGhostty([file("# nothing\n")], read))).toBe(false);
  });
});
