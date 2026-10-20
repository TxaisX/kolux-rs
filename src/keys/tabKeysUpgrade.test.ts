// SET-015: the upgrade seeding of the old tab-stepping pairing.
import { expect, test } from "vitest";
import { chordsOf, resolve } from "./keymap";
import { seedOldTabPairing } from "./tabKeysUpgrade";

test("SET-015: a new install gets nothing written, so the new defaults stand", () => {
  expect(seedOldTabPairing(null, false)).toBeNull();
  const map = resolve(null, "win32");
  expect(chordsOf(map, "tab.nextAllTypes")).toEqual(["Mod+Shift+BracketRight"]);
  expect(chordsOf(map, "tab.nextSameType")).toEqual(["Mod+Alt+BracketRight"]);
});

test("SET-015: an upgraded install keeps the reversed pairing it was used to, and the keymap reads it", () => {
  const seeded = seedOldTabPairing({ keybindings: { "app.settings": ["Mod+Comma"] } }, true);
  expect(seeded).not.toBeNull();
  const map = resolve(seeded, "win32");
  expect(map.errors).toEqual([]);
  expect(chordsOf(map, "tab.nextSameType")).toEqual(["Mod+Shift+BracketRight"]);
  expect(chordsOf(map, "tab.previousAllTypes")).toEqual(["Mod+Alt+BracketLeft"]);
  expect(chordsOf(map, "app.settings")).toEqual(["Mod+Comma"]); // the rest of the file is kept
  expect(map.clashes).toEqual([]);
});

test("SET-015: no file yet gets a keybindings section; the older top-level form stays in its own form", () => {
  expect(seedOldTabPairing(null, true)).toHaveProperty("keybindings");
  const older = seedOldTabPairing({ "app.settings": ["Mod+Comma"] }, true) as Record<string, unknown>;
  expect(older["tab.nextSameType"]).toEqual(["Mod+Shift+BracketRight"]);
  expect(older).not.toHaveProperty("keybindings");
  expect(chordsOf(resolve(older, "linux"), "tab.nextAllTypes")).toEqual(["Mod+Alt+BracketRight"]);
});

test("SET-015: a file that already names any of the four commands, in any section, is left alone", () => {
  expect(seedOldTabPairing({ keybindings: { "tab.nextAllTypes": ["Mod+J"] } }, true)).toBeNull();
  expect(seedOldTabPairing({ platforms: { darwin: { "tab.previousSameType": [] } } }, true)).toBeNull();
  const once = seedOldTabPairing({ keybindings: {} }, true);
  expect(seedOldTabPairing(once, true)).toBeNull(); // never repeats
  expect(seedOldTabPairing({ keybindings: 5 }, true)).toBeNull();
});
