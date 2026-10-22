import { expect, test } from "vitest";
import { actions } from "./actions";
import { resolve } from "./keymap";

// AFTER row 119 (T-239): Ctrl+Shift+Tab is its own command, so the Ctrl+Tab switcher can step back.
test("Ctrl+Shift+Tab is bound to a command that steps the recent-tabs switcher backwards", () => {
  const a = actions.find((x) => x.id === "tab.nextRecent");
  expect(a?.win32).toEqual(["Ctrl+Shift+Tab"]);
  const map = resolve(null, "win32");
  expect(map.bindings.get("tab.nextRecent")?.chords).toEqual(["Ctrl+Shift+Tab"]);
  expect(map.clashes.filter((c) => c.ids.includes("tab.nextRecent"))).toEqual([]);
});
