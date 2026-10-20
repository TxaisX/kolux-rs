import { expect, test } from "vitest";
import { actionById } from "./actions";
import { ALTGR_ZOOM_NOTE, layoutNotes } from "./helpNotes";

test("SET-019: the AltGr rebind note shows on Windows and Linux, never on macOS", () => {
  expect(layoutNotes("win32")).toContain(ALTGR_ZOOM_NOTE);
  expect(layoutNotes("linux")).toContain(ALTGR_ZOOM_NOTE);
  expect(layoutNotes("darwin")).not.toContain(ALTGR_ZOOM_NOTE);
});

test("SET-019: the note names the chords the interface zoom commands really hold", () => {
  const out = actionById.get("ui.zoomOut");
  const reset = actionById.get("ui.zoomReset");
  expect(out?.win32).toEqual(["Mod+Alt+Minus"]);
  expect(reset?.win32).toEqual(["Mod+Alt+0"]);
});
