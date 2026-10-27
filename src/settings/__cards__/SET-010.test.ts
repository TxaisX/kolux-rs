// SET-010 box 2, code half: on macOS a chosen Ctrl+digit chord gets the system-capture warning; Windows and Linux stay quiet.
// The Mac leg (Mission Control desktop switching really on) is MAC-open.
import { expect, test } from "vitest";
import { resolve } from "../../keys/keymap";
import { systemCaptureWarning } from "../../keys/systemCapture";
import { shortcutRows } from "../shortcutRows";

const rowFor = (platform: "darwin" | "win32" | "linux", chord: string) =>
  shortcutRows(resolve({ keybindings: { "terminal.clear": chord } }, platform)).find((r) => r.id === "terminal.clear")!;

test("SET-010 box 2 (code half): binding Ctrl+2 on macOS shows the system-capture warning under that row", () => {
  const r = rowFor("darwin", "Ctrl+2");
  expect(r.chords).toEqual(["Ctrl+2"]);
  expect(r.warning).toBe(systemCaptureWarning("Ctrl+2"));
  expect(r.warning).toMatch(/Mission Control desktop switching/);
});

test("SET-010 box 2 (code half): the same chord on Windows and Linux shows no warning", () => {
  expect(rowFor("win32", "Ctrl+2").warning).toBeUndefined();
  expect(rowFor("linux", "Ctrl+2").warning).toBeUndefined();
});
