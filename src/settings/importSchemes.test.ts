// SET-024 (T-323): Warp and Ghostty files become custom schemes; broken files bring in nothing.
import { describe, expect, it } from "vitest";
import { MAX_CUSTOM, parseGhostty, parseSchemeFile, parseWarp, planImport, planSummary, sameColours } from "./importSchemes";

const WARP = `# a Warp theme
accent: '#1b8fe3'
background: '#1e1e1e'
details: darker
foreground: '#e0e0e0'
terminal_colors:
  bright:
    black: '#555555'
    red: '#ff5555'
  normal:
    black: '#000000'
    red: '#cc0000'
    blue: '0037da'
`;

describe("SET-024 bring schemes in", () => {
  it("a valid Warp theme becomes a scheme named after the file", () => {
    const s = parseWarp(WARP, "C:/themes/my_night.yaml");
    expect(s).toMatchObject({ name: "my night", background: "#1e1e1e", foreground: "#e0e0e0", cursor: "#1b8fe3", black: "#000000", red: "#cc0000", blue: "#0037da", brightBlack: "#555555", brightRed: "#ff5555" });
    expect(parseWarp(WARP.replace("details:", "name: 'Night Owl'\ndetails:"))).toMatchObject({ name: "Night Owl" });
  });

  it("a broken Warp file throws with a reason", () => {
    expect(() => parseWarp("background: '#000000'\n", "x.yaml")).toThrow(/not a Warp theme/);
    expect(() => parseWarp("{{{ nonsense", "x.yaml")).toThrow(/not a Warp theme/);
  });

  it("a Ghostty configuration brings its colours and palette", () => {
    const s = parseGhostty("font-size = 13\nbackground = 282c34\nforeground = #dcdfe4\npalette = 0=#1d1f21\npalette = 9=#ff6e6e\ncursor-color = ffffff\n# palette = 1=#000000\n");
    expect(s).toMatchObject({ name: "Ghostty", background: "#282c34", foreground: "#dcdfe4", black: "#1d1f21", brightRed: "#ff6e6e", cursor: "#ffffff" });
    expect(s.red).toBeUndefined();
  });

  it("a Ghostty file with only a built-in theme or no colours is refused", () => {
    expect(() => parseGhostty("theme = Dracula\n")).toThrow(/built-in theme "Dracula"/);
    expect(() => parseGhostty("font-size = 13\n")).toThrow(/not a Ghostty configuration/);
  });

  it("the file kind is picked from the name or the content", () => {
    expect(parseSchemeFile("night.yml", WARP).name).toBe("night");
    expect(parseSchemeFile("config", "background = 000000\nforeground = ffffff").name).toBe("Ghostty");
  });

  it("a config already matching the terminal says so", () => {
    const s = parseGhostty("background = 000000\nforeground = ffffff");
    expect(sameColours(s, { background: "#000000", foreground: "#FFFFFF", red: "#cc0000" })).toBe(true);
    expect(sameColours(s, { background: "#111111", foreground: "#ffffff" })).toBe(false);
  });

  it("only ticked schemes apply; the cap refuses new ones but allows a replacement", () => {
    const a = { name: "A", background: "#000000", foreground: "#ffffff" };
    const full = Array.from({ length: MAX_CUSTOM }, (_, i) => ({ ...a, name: "S" + i }));
    expect(planImport([a], []).custom).toEqual([a]);
    expect(planSummary(planImport([a], []))).toMatch(/Nothing was ticked/);
    const p = planImport(full, [{ ...a, name: "s3", background: "#101010" }, { ...a, name: "New" }]);
    expect(p.replaced).toEqual(["s3"]);
    expect(p.refused).toEqual(["New"]);
    expect(p.custom).toHaveLength(MAX_CUSTOM);
    expect(p.custom[3].background).toBe("#101010");
    expect(planSummary(p)).toMatch(/Not added: New, because you already have 40/);
  });
});
