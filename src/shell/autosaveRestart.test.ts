import { describe, expect, it } from "vitest";
import { prefPatch, readEditorPrefs } from "../settings/editorPrefs";

// What the settings file does between runs: a patch is merged into the stored object, written as JSON and read back at the next start.
const restart = (stored: Record<string, unknown>, ...patches: Record<string, unknown>[]) => JSON.parse(JSON.stringify(Object.assign({}, stored, ...patches))) as Record<string, unknown>;

describe("editor autosave survives a restart", () => {
  it("on and its pause come back as chosen", () => {
    const after = restart({}, prefPatch("autoSave", true), prefPatch("autoSaveDelay", 2500));
    const p = readEditorPrefs(after);
    expect([p.autoSave, p.autoSaveDelay]).toEqual([true, 2500]);
  });
  it("off stays off, and a fresh profile starts off with the 1000 ms pause", () => {
    expect(readEditorPrefs(restart({}, prefPatch("autoSave", true), prefPatch("autoSave", false))).autoSave).toBe(false);
    const fresh = readEditorPrefs(restart({}));
    expect([fresh.autoSave, fresh.autoSaveDelay]).toEqual([false, 1000]);
  });
  it("changing another preference leaves them alone, and a damaged pause is clamped on the way back", () => {
    const stored = restart({}, prefPatch("autoSave", true), prefPatch("autoSaveDelay", 4000));
    const p = readEditorPrefs(restart(stored, prefPatch("minimap", true)));
    expect([p.autoSave, p.autoSaveDelay, p.minimap]).toEqual([true, 4000, true]);
    expect(readEditorPrefs({ editorAutoSave: true, editorAutoSaveDelay: "soon" }).autoSaveDelay).toBe(1000);
    expect(readEditorPrefs({ editorAutoSave: true, editorAutoSaveDelay: 99999999 }).autoSaveDelay).toBeLessThan(99999999);
  });
});
