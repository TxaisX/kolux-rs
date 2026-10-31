// SET-038 (T-323): editor and diff preference defaults, auto-save timing and whitespace hiding.
import { afterEach, describe, expect, it, vi } from "vitest";
import { autoSaver, EDITOR_FIELDS, hiddenWhitespace, prefPatch, readEditorPrefs } from "./editorPrefs";
import { appearanceVars, readAppearance } from "../theme";

afterEach(() => vi.useRealTimers());

describe("SET-038 editor and diff preferences", () => {
  it("defaults match the card", () => {
    expect(readEditorPrefs({})).toEqual({ autoSave: false, autoSaveDelay: 1000, minimap: false, wordWrap: true, spellcheck: true, diffView: "inline", diffWordWrap: false, diffWhitespace: false, diffTree: false });
  });

  it("auto-save on with 1000 ms writes a second after typing stops", () => {
    vi.useFakeTimers();
    const write = vi.fn();
    expect(autoSaver(readEditorPrefs({}), write)).toBeNull();
    const saver = autoSaver(readEditorPrefs({ [EDITOR_FIELDS.autoSave]: true, [EDITOR_FIELDS.autoSaveDelay]: 1000 }), write)!;
    saver.edit();
    vi.advanceTimersByTime(600);
    saver.edit();
    vi.advanceTimersByTime(999);
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("whitespace-only changes show only with whitespace display on", () => {
    expect(hiddenWhitespace("a  b", "a b", false)).toBe(true);
    expect(hiddenWhitespace("a  b", "a b", true)).toBe(false);
    expect(hiddenWhitespace("a b", "a c", false)).toBe(false);
  });

  it("editor and diff word wrap are separate, and the delay is clamped", () => {
    const s = { ...prefPatch("diffWordWrap", true) };
    expect(readEditorPrefs(s)).toMatchObject({ diffWordWrap: true, wordWrap: true });
    expect(prefPatch("autoSaveDelay", 5)).toEqual({ editorAutosavePause: 250 });
  });

  it("SET-018: an empty editor font falls back to the terminal font", () => {
    const vars = appearanceVars(readAppearance({ terminalFont: "Cascadia Mono" })) as Record<string, string>;
    expect(vars["--editor-font"].startsWith('"Cascadia Mono"')).toBe(true);
  });
});
