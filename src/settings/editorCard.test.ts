// FIX-3: Settings > General has one Editor card, and its autosave switch and pause are the very
// settings the editor tabs obey (EDIT-002 autosaveOf, read by the app for every edit and diff tab).
import { expect, test } from "vitest";
import { createElement } from "react";
import generalSource from "./GeneralPage.tsx?raw";
import prefsSource from "./editorPrefs.ts?raw";
import appSource from "../App.tsx?raw";
import { renderToString } from "react-dom/server";
import { autosaveOf, AUTOSAVE_KEY, AUTOSAVE_PAUSE_KEY } from "../editor/autosave";
import { EDITOR_FIELDS, prefPatch, readEditorPrefs } from "./editorPrefs";
import { EditorCard } from "./GeneralPage";

test("FIX-3: the Editor card writes the autosave keys the app reads", () => {
  expect(EDITOR_FIELDS.autoSave).toBe(AUTOSAVE_KEY);
  expect(EDITOR_FIELDS.autoSaveDelay).toBe(AUTOSAVE_PAUSE_KEY);
  // What the card's switch and pause field save, laid over a fresh profile, is what the app reads.
  const on = { ...prefPatch("autoSave", true), ...prefPatch("autoSaveDelay", 2500) };
  expect(autosaveOf(on)).toBe(2500);
  expect(readEditorPrefs(on)).toMatchObject({ autoSave: true, autoSaveDelay: 2500 });
  expect(autosaveOf({ ...on, ...prefPatch("autoSave", false) })).toBeNull();
  // The pause edges agree too: below the floor and above the ceiling clamp the same way in both.
  for (const ms of [5, 250, 10_000, 99_999]) {
    const s = { ...prefPatch("autoSave", true), ...prefPatch("autoSaveDelay", ms) };
    expect(readEditorPrefs(s).autoSaveDelay).toBe(autosaveOf(s));
  }
  // Fresh profile: off in the card and in the app (EDIT-002 first box).
  expect(readEditorPrefs({}).autoSave).toBe(false);
  expect(autosaveOf({})).toBeNull();
});

test("FIX-3: the card shows the app's autosave state, and General mounts exactly one Editor card", () => {
  const off = renderToString(createElement(EditorCard, { settings: {}, onSave: () => {} }));
  expect(off).toContain('aria-label="Autosave"');
  expect(off).not.toContain("Autosave pause in seconds");
  const on = renderToString(createElement(EditorCard, { settings: { [AUTOSAVE_KEY]: true, [AUTOSAVE_PAUSE_KEY]: 2500 }, onSave: () => {} }));
  expect(on).toMatch(/aria-label="Autosave"[^>]*checked=""/);
  expect(on).toMatch(/aria-label="Autosave pause in seconds"[^>]*value="2.5"/);
  // The old key the second card used is not written or read anywhere in the app.
  expect(generalSource.match(/data-section="editor"/g) ?? []).toHaveLength(1);
  expect(generalSource.match(/<EditorCard /g) ?? []).toHaveLength(1);
  for (const text of [generalSource, prefsSource, appSource]) expect(text).not.toContain("editorAutoSave");
});
