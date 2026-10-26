// TERM-006 acceptance box 2 and the shortcut rules: the chord table, then what the pane does with Ctrl+D.
import { expect, test } from "vitest";
import { chordsOf, matchEvent, resolve, type KeyLike } from "../../keys/keymap";
import { encodeKitty, latinControl } from "../kittyKeys";
import { routeKey } from "../shellKeys";

const press = (k: Partial<KeyLike>): KeyLike => ({ key: "d", code: "KeyD", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...k });
const linux = resolve(null, "linux");
const win = resolve(null, "win32");
const mac = resolve(null, "darwin");
const scopes = ["global", "terminal", "tabs"] as const;

test("box 2: Ctrl+D in a Linux shell pane is not a Kolux chord, so the shell gets end-of-input", () => {
  const ctrlD = press({ ctrlKey: true });
  expect(matchEvent(linux, ctrlD, [...scopes])).toBeNull();
  // the pane's own router (TerminalPane key handler): left to the shell, not split
  expect(routeKey(linux, ctrlD, false)).toEqual({ kind: "shell" });
  // nothing re-encodes it: no enhanced keyboard protocol, a Latin layout, so xterm sends its own control byte 0x04
  expect(encodeKitty({ type: "keydown", ...ctrlD }, 0)).toBeNull();
  expect(latinControl({ type: "keydown", ...ctrlD })).toBeNull();
  // the same on Windows (bare Ctrl+D reaches the shell as end-of-input)
  expect(routeKey(win, ctrlD, false)).toEqual({ kind: "shell" });
  expect(matchEvent(win, ctrlD, [...scopes])).toBeNull();
});

test("the split chords: Ctrl+Shift+D right and Alt+Shift+D down on Windows/Linux, Cmd+D and Cmd+Shift+D on macOS; split needs Shift", () => {
  for (const map of [linux, win]) {
    expect(routeKey(map, press({ key: "D", ctrlKey: true, shiftKey: true }), false)).toEqual({ kind: "kolux", id: "terminal.splitRight" });
    expect(routeKey(map, press({ key: "D", altKey: true, shiftKey: true }), false)).toEqual({ kind: "kolux", id: "terminal.splitDown" });
    expect(matchEvent(map, press({ altKey: true }), [...scopes])).toBeNull(); // no Shift, no split
  }
  expect(chordsOf(linux, "terminal.splitRight")).toEqual(["Mod+Shift+D"]);
  expect(chordsOf(linux, "terminal.splitDown")).toEqual(["Alt+Shift+D"]);
  expect(chordsOf(mac, "terminal.splitRight")).toEqual(["Mod+D"]);
  expect(chordsOf(mac, "terminal.splitDown")).toEqual(["Mod+Shift+D"]);
});
