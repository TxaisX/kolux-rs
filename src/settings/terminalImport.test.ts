// TERM-099 / TERM-100 (T-307): Ghostty settings and Warp themes brought in. The pure parts only:
// the folders are read by the back end (term_import.rs) and the dialog lives in TerminalImport.tsx.
import { describe, expect, it } from "vitest";
import { MAX_CONFIG_CHARS, importGhostty, parseWarpTheme, plainSkip, scanWarp, type GhosttyFileIn } from "./importSchemes";

const file = (text: string, label = "config"): GhosttyFileIn => ({ label, text });
const NO_THEMES = () => null;

describe("TERM-099 Ghostty configuration", () => {
  it("maps font, cursor, scrollback, divider colour and unfocused opacity onto Kolux's own settings", () => {
    const r = importGhostty([file("font-family = JetBrains Mono\nfont-size = 13\ncursor-style = bar\ncursor-style-blink = false\nscrollback-limit = 20000000\nsplit-divider-color = #445566\nunfocused-split-opacity = 0.5\ncopy-on-select = clipboard\n")], NO_THEMES);
    expect(r.settings).toEqual({ terminalFont: "JetBrains Mono", terminalFontSize: 13, terminalCursorStyle: "bar", terminalCursorBlink: false, terminalScrollback: 20000, paneDividerDark: "#445566", paneDividerLight: "#445566", paneDim: 50, terminalCopyOnSelect: true });
    expect(r.invalid).toEqual([]);
    expect(r.unsupported).toEqual([]);
  });

  it("colours and the palette become one scheme; the explicit colours win over a theme", () => {
    const theme = "background = 101010\nforeground = #eeeeee\npalette = 1=#aa0000\ncursor-color = #ffffff\n";
    const get = (n: string) => (n === "Midnight" ? theme : null);
    const r = importGhostty([file("theme = Midnight\nbackground = 000000\npalette = 9=#ff0000\n")], get);
    expect(r.schemes).toHaveLength(1);
    expect(r.schemes[0]).toMatchObject({ name: "Midnight (Ghostty)", background: "#000000", foreground: "#eeeeee", red: "#aa0000", brightRed: "#ff0000", cursor: "#ffffff" });
    expect(importGhostty([file("theme = Midnight\n")], get).schemes[0].name, "no overrides: the theme's own name").toBe("Midnight");
    expect(importGhostty([file("background = 111111\nforeground = eeeeee\n")], NO_THEMES).schemes[0].name).toBe("Ghostty");
  });

  it("light and dark theme pairs give two schemes, dark first", () => {
    const get = (n: string) => (n === "Day" ? "background = ffffff\nforeground = 000000\n" : n === "Night" ? "background = 000000\nforeground = ffffff\n" : null);
    const r = importGhostty([file("theme = light:Day,dark:Night\n")], get);
    expect(r.schemes.map((s) => s.name)).toEqual(["Night", "Day"]);
    expect(r.darkScheme).toBe("Night");
    expect(r.lightScheme).toBe("Day");
  });

  it("a theme that cannot be found, or names a folder, is reported instead of guessed", () => {
    const missing = importGhostty([file("theme = Nowhere\n")], NO_THEMES);
    expect(missing.schemes).toEqual([]);
    expect(missing.invalid).toEqual([{ key: "theme", value: "Nowhere", reason: expect.stringMatching(/not found in Ghostty's theme folders/) }]);
    const dodgy = importGhostty([file("theme = ../../secret\n")], () => "background = 000000\nforeground = ffffff");
    expect(dodgy.schemes).toEqual([]);
    expect(dodgy.invalid[0].reason).toMatch(/folder/);
  });

  it("TERM-099 acceptance: an unknown key is listed as unsupported, and so is one Kolux has no setting for yet", () => {
    const r = importGhostty([file("font-size = 12\nfrobnicate = yes\nwindow-padding-x = 8\nmacos-option-as-alt = true\nbold-color = #ffffff\nselection-word-chars = abc\nmouse-hide-while-typing = true\nfocus-follows-mouse = true\nbackground-blur-radius = 20\nwindow-padding-x = 4\n")], NO_THEMES);
    expect(r.unsupported).toEqual(["frobnicate", "window-padding-x", "macos-option-as-alt", "bold-color", "selection-word-chars", "mouse-hide-while-typing", "focus-follows-mouse", "background-blur-radius"]);
    expect(r.settings).toEqual({ terminalFontSize: 12 });
  });

  it("TERM-099 acceptance: an invalid value is reported with its value, and nothing is guessed", () => {
    const r = importGhostty([file("font-size = big\ncursor-style = squiggle\ncursor-style-blink = maybe\nscrollback-limit = -5\nunfocused-split-opacity = 7\nsplit-divider-color = reddish\nforeground = nothex\nfont-size = 99\n")], NO_THEMES);
    expect(r.settings).toEqual({});
    expect(r.invalid.map((i) => [i.key, i.value])).toEqual([["font-size", "big"], ["cursor-style", "squiggle"], ["cursor-style-blink", "maybe"], ["scrollback-limit", "-5"], ["unfocused-split-opacity", "7"], ["split-divider-color", "reddish"], ["foreground", "nothex"], ["font-size", "99"]]);
    expect(r.invalid.every((i) => i.reason.length > 5)).toBe(true);
    expect(r.invalid[7].reason).toMatch(/10 to 24/);
  });

  it("zero means off: a zero or false on a key Kolux has no setting for is not reported as dropped; a zero scrollback switches it off", () => {
    const r = importGhostty([file("window-padding-x = 0\nbackground-blur = 0\nmouse-hide-while-typing = false\nscrollback-limit = 0\nbold-color = 0\n")], NO_THEMES);
    expect(r.unsupported).toEqual(["bold-color"]);
    expect(r.settings).toEqual({ terminalScrollback: 0 });
    expect(r.invalid).toEqual([]);
  });

  it("an oversized file is skipped and reported while the settings already imported are kept", () => {
    const big = "# " + "x".repeat(MAX_CONFIG_CHARS);
    const r = importGhostty([file("font-size = 15\n", "config"), file(big, "huge"), { label: "locked", skipped: "could not be read" }, file("cursor-style = underline\n", "later")], NO_THEMES);
    expect(r.settings).toEqual({ terminalFontSize: 15, terminalCursorStyle: "underline" });
    expect(r.skipped).toEqual([{ file: "huge", reason: expect.stringMatching(/too large/) }, { file: "locked", reason: "could not be read" }]);
  });

  it("later files override earlier ones, comments and quotes are handled, and a line without = is reported", () => {
    const r = importGhostty([file('# comment\nfont-family = "Fira Code"\ncursor-style = block\n'), file("cursor-style = bar\nthis is not a setting\n", "more")], NO_THEMES);
    expect(r.settings).toMatchObject({ terminalFont: "Fira Code", terminalCursorStyle: "bar" });
    expect(r.invalid).toEqual([{ key: "this is not a setting", value: "", reason: "not a key = value line" }]);
  });

  it("a very long junk line is shown cut short, not whole (FIX-2)", () => {
    const r = importGhostty([file("x".repeat(500) + "\n")], NO_THEMES);
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0].key.length).toBeLessThanOrEqual(61);
    expect(r.invalid[0].key.endsWith("…")).toBe(true);
    expect(r.invalid[0].key.startsWith("xxxx")).toBe(true);
  });

  it("a config with no colours gives no scheme", () => {
    expect(importGhostty([file("font-size = 12\n")], NO_THEMES).schemes).toEqual([]);
  });
});

const WARP_BG = `accent: '#1b8fe3'
background: '#1e1e1e'
foreground: '#e0e0e0'
background_image:
  path: wallpaper.png
  opacity: 40
terminal_colors:
  bright:
    black: '#555555'
  normal:
    black: '#000000'
`;

describe("TERM-100 Warp themes", () => {
  it("TERM-100 acceptance: a theme with a background image is added without the image, and the image is reported as skipped", () => {
    const t = parseWarpTheme(WARP_BG, "night.yaml");
    expect(t.scheme).toMatchObject({ name: "night", background: "#1e1e1e" });
    expect(t.left).toEqual(["background image"]);
  });

  it("gradients are flattened to their first colour and reported as skipped", () => {
    const text = WARP_BG.replace("background_image:\n  path: wallpaper.png\n  opacity: 40\n", "").replace("background: '#1e1e1e'", "background:\n  top: '#101010'\n  bottom: '#303030'").replace("accent: '#1b8fe3'", "accent: { top: '#ff0000', bottom: '#00ff00' }");
    const t = parseWarpTheme(text, "grad.yaml");
    expect(t.scheme).toMatchObject({ background: "#101010", cursor: "#ff0000" });
    expect(t.left).toEqual(["background gradient", "accent gradient"]);
  });

  it("TERM-100 acceptance: a malformed or endless file fails with a message", () => {
    expect(() => parseWarpTheme("{{{ nonsense", "bad.yaml")).toThrow(/not a Warp theme/);
    expect(() => parseWarpTheme("a: 1\n".repeat(6000), "long.yaml")).toThrow(/too long/);
    let t = 0;
    expect(() => parseWarpTheme(WARP_BG, "slow.yaml", { ms: 5, now: () => (t += 4) })).toThrow(/took too long/);
  });

  it("the scan keeps good themes, lists skipped files by name only, and never shows a full folder path", () => {
    const scan = scanWarp([
      { name: "night.yaml", text: WARP_BG },
      { name: "broken.yaml", text: "background: '#000000'\n" },
      { name: "huge.yaml", skipped: "is too large to read" },
      { name: "C:\\Users\\someone\\AppData\\Local\\warp\\themes\\sneaky.yaml", text: "nonsense: [" },
    ]);
    expect(scan.themes.map((t) => t.file)).toEqual(["night.yaml"]);
    expect(scan.themes[0].left).toEqual(["background image"]);
    expect(scan.skipped.map((s) => s.file)).toEqual(["broken.yaml", "huge.yaml", "sneaky.yaml"]);
    expect(JSON.stringify(scan.skipped)).not.toMatch(/Users|AppData|C:/);
  });

  it("plainSkip drops folder paths from a reason", () => {
    expect(plainSkip("x.yaml", "cannot open C:\\Users\\me\\AppData\\x.yaml: denied").reason).not.toMatch(/Users/);
    expect(plainSkip("/home/me/.warp/themes/x.yaml", "no /home/me/.warp/themes/x.yaml here")).toEqual({ file: "x.yaml", reason: "no x.yaml here" });
  });
});
