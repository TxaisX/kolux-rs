// SET-009 (T-096-b): turning a key press into a chord, and the edits on a command's chord list.
import { expect, test } from "vitest";
import { editChords, recordKey, removeChord } from "./record";

const key = (code: string, k: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean; repeat: boolean }> = {}) => ({ code, key: k, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test("a press becomes a chord written with Mod for this platform's main modifier", () => {
  expect(recordKey(key("KeyK", "K", { ctrlKey: true, shiftKey: true }), "win32", "terminal.clear")).toEqual({ chord: "Mod+Shift+K" });
  expect(recordKey(key("KeyK", "k", { metaKey: true }), "darwin", "terminal.clear")).toEqual({ chord: "Mod+K" });
  expect(recordKey(key("KeyK", "k", { ctrlKey: true }), "darwin", "terminal.clear")).toEqual({ chord: "Ctrl+K" });
  expect(recordKey(key("ArrowUp", "ArrowUp", { altKey: true }), "win32", "x")).toEqual({ chord: "Alt+ArrowUp" });
  expect(recordKey(key("Comma", ",", { ctrlKey: true }), "linux", "x")).toEqual({ chord: "Mod+Comma" });
  expect(recordKey(key("F5", "F5", { ctrlKey: true }), "win32", "x")).toEqual({ chord: "Mod+F5" });
  // The digit-index commands cover 1 to 9 from a chord ending in 1.
  expect(recordKey(key("Digit4", "4", { altKey: true }), "win32", "tab.selectByIndex")).toEqual({ chord: "Alt+1" });
});

test("Esc ends recording, a lone modifier keeps waiting, Shift alone is refused", () => {
  expect(recordKey(key("Escape", "Escape"), "win32", "x")).toEqual({ cancel: true });
  expect(recordKey(key("ControlLeft", "Control", { ctrlKey: true }), "win32", "x")).toBeNull();
  expect(recordKey(key("ShiftRight", "Shift", { shiftKey: true }), "win32", "x")).toBeNull();
  expect(recordKey(key("KeyK", "K", { shiftKey: true }), "win32", "x")).toHaveProperty("refused");
  expect(recordKey(key("KeyK", "k"), "win32", "x")).toHaveProperty("refused");
  // The one exception: Shift+Space for the command that switches the system input source.
  expect(recordKey(key("Space", " ", { shiftKey: true }), "win32", "terminal.switchInputSource")).toEqual({ chord: "Shift+Space" });
  expect(recordKey(key("Space", " ", { shiftKey: true }), "win32", "terminal.clear")).toHaveProperty("refused");
  // A held key repeating is not a new press.
  expect(recordKey(key("KeyK", "K", { ctrlKey: true, repeat: true }), "win32", "x")).toBeNull();
});

test("each chord of a command is replaced, added or removed on its own", () => {
  expect(editChords(["Mod+K"], 0, "Mod+Shift+K")).toEqual(["Mod+Shift+K"]);
  expect(editChords(["Mod+K"], 1, "Alt+K")).toEqual(["Mod+K", "Alt+K"]);
  // Recording a chord the command already holds does not list it twice.
  expect(editChords(["Mod+K", "Alt+K"], 1, "Mod+K")).toEqual(["Mod+K"]);
  // Removing the chord being recorded ends recording; removing another keeps it on the same chord.
  expect(removeChord(["A", "B", "C"], 1, { index: 1 })).toEqual({ chords: ["A", "C"], recording: null });
  expect(removeChord(["A", "B", "C"], 0, { index: 2 })).toEqual({ chords: ["B", "C"], recording: { index: 1 } });
  expect(removeChord(["A", "B", "C"], 2, { index: 0 })).toEqual({ chords: ["A", "B"], recording: { index: 0 } });
  expect(removeChord(["A", "B"], 0, null)).toEqual({ chords: ["B"], recording: null });
});
