// SET-010: on macOS a chord the system itself grabs (Mission Control desktop switching) is flagged
// on the Shortcuts row; other platforms and ordinary chords stay quiet.
import { expect, test } from "vitest";
import { resolve } from "./keymap";
import { shortcutRows } from "../settings/shortcutRows";
import { systemCaptureWarning } from "./systemCapture";

const warn = (platform: "darwin" | "win32" | "linux", id: string, chord: string) =>
  shortcutRows(resolve({ keybindings: { [id]: chord } }, platform)).find((r) => r.id === id)?.warning;

test("mac: binding Ctrl+2 shows the system-capture warning on that row", () => {
  expect(warn("darwin", "terminal.clear", "Ctrl+2")).toBe(systemCaptureWarning("Ctrl+2"));
  expect(warn("darwin", "terminal.clear", "Ctrl+2")).toMatch(/Ctrl\+2 may be captured by macOS/);
});

test("mac: every Ctrl+digit 1-9 and the Ctrl+arrow Mission Control chords are flagged", () => {
  for (const k of ["1", "5", "9", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) expect(warn("darwin", "terminal.clear", `Ctrl+${k}`), k).toBeTruthy();
});

test("windows and linux: Ctrl+2 shows no warning", () => {
  expect(warn("win32", "terminal.clear", "Ctrl+2")).toBeUndefined();
  expect(warn("linux", "terminal.clear", "Ctrl+2")).toBeUndefined();
});

test("mac: an ordinary chord, Cmd+2, Ctrl+Shift+2 or Ctrl+0 shows no warning", () => {
  for (const c of ["Mod+Shift+K", "Cmd+2", "Ctrl+Shift+2", "Ctrl+0", "Ctrl+K"]) expect(warn("darwin", "terminal.clear", c), c).toBeUndefined();
});

test("mac: the shipped default Ctrl+1 on Select Tab 1-9 is not flagged (only a chord the user chose)", () => {
  const row = shortcutRows(resolve(null, "darwin")).find((r) => r.id === "tab.selectByIndex")!;
  expect(row.warning).toBeUndefined();
});
