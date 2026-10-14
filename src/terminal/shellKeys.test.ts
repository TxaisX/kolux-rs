import { describe, expect, it } from "vitest";
import { resolve } from "../keys/keymap";
import { routeKey, type RoutedKey } from "./shellKeys";

const key = (code: string, k: string, mods: Partial<RoutedKey> = {}): RoutedKey => ({ code, key: k, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });
const win = resolve(null, "win32");
const mac = resolve(null, "darwin");

describe("TERM-079 Kolux shortcuts versus shell keys", () => {
  it("Ctrl+R and Ctrl+Arrow reach the shell on Windows; a Kolux chord never does", () => {
    expect(routeKey(win, key("KeyR", "r", { ctrlKey: true }), false)).toEqual({ kind: "shell" });
    expect(routeKey(win, key("ArrowRight", "ArrowRight", { ctrlKey: true }), false)).toEqual({ kind: "shell" });
    expect(routeKey(win, key("KeyA", "a"), false)).toEqual({ kind: "shell" });
    // Mod+K is Clear active pane, Mod+F is Search, Mod+W is Close pane, Ctrl+Tab the recent tab: all Kolux's
    expect(routeKey(win, key("KeyK", "k", { ctrlKey: true }), false)).toEqual({ kind: "kolux", id: "terminal.clear" });
    expect(routeKey(win, key("KeyF", "f", { ctrlKey: true }), false)).toEqual({ kind: "kolux", id: "terminal.search" });
    expect(routeKey(win, key("KeyW", "w", { ctrlKey: true }), false).kind).toBe("kolux");
    expect(routeKey(win, key("Tab", "Tab", { ctrlKey: true }), false)).toEqual({ kind: "kolux", id: "tab.previousRecent" });
  });

  it("Ctrl+C is the program's interrupt with nothing selected and Kolux's copy with a selection", () => {
    const c = key("KeyC", "c", { ctrlKey: true });
    expect(routeKey(win, c, false)).toEqual({ kind: "shell" });
    expect(routeKey(win, c, true)).toEqual({ kind: "kolux", id: "terminal.copySelection" });
    expect(routeKey(win, key("KeyC", "C", { ctrlKey: true, shiftKey: true }), false).kind).toBe("kolux");
  });

  it("honours a custom pane keybinding from the user's file", () => {
    const custom = resolve({ keybindings: { "terminal.clear": ["Ctrl+Shift+L"] } }, "win32");
    expect(custom.bindings.get("terminal.clear")?.chords).toEqual(["Ctrl+Shift+L"]);
    expect(routeKey(custom, key("KeyL", "L", { ctrlKey: true, shiftKey: true }), false)).toEqual({ kind: "kolux", id: "terminal.clear" });
    expect(routeKey(custom, key("KeyK", "k", { ctrlKey: true }), false)).toEqual({ kind: "shell" });
  });

  it("Alt+Arrow moves by word on every platform: ESC b/f on macOS, the Ctrl+Arrow encoding on Windows", () => {
    expect(routeKey(mac, key("ArrowLeft", "ArrowLeft", { altKey: true }), false)).toEqual({ kind: "send", data: "\x1bb" });
    expect(routeKey(mac, key("ArrowRight", "ArrowRight", { altKey: true }), false)).toEqual({ kind: "send", data: "\x1bf" });
    expect(routeKey(win, key("ArrowLeft", "ArrowLeft", { altKey: true }), false)).toEqual({ kind: "send", data: "\x1b[1;5D" });
    expect(routeKey(win, key("ArrowRight", "ArrowRight", { altKey: true }), false)).toEqual({ kind: "send", data: "\x1b[1;5C" });
  });

  it("on macOS the shell's Ctrl chords stay the shell's, Cmd+Left jumps to column one, Cmd+Up to the top", () => {
    // Ctrl+1 is Select Tab 1 on macOS; Ctrl+A is the shell's line start even though the chord table could claim letters
    expect(routeKey(mac, key("KeyA", "a", { ctrlKey: true }), false)).toEqual({ kind: "shell" });
    expect(routeKey(mac, key("KeyR", "r", { ctrlKey: true }), false)).toEqual({ kind: "shell" });
    expect(routeKey(mac, key("ArrowLeft", "ArrowLeft", { metaKey: true }), false)).toEqual({ kind: "send", data: "\x01" });
    expect(routeKey(mac, key("ArrowRight", "ArrowRight", { metaKey: true }), false)).toEqual({ kind: "send", data: "\x05" });
    expect(routeKey(mac, key("ArrowUp", "ArrowUp", { metaKey: true }), false)).toEqual({ kind: "scroll", to: "top" });
    expect(routeKey(mac, key("ArrowDown", "ArrowDown", { metaKey: true }), false)).toEqual({ kind: "scroll", to: "bottom" });
    // Cmd+K is still Kolux's clear on macOS
    expect(routeKey(mac, key("KeyK", "k", { metaKey: true }), false)).toEqual({ kind: "kolux", id: "terminal.clear" });
  });

  it("a composing key (IME) is left to the terminal's composition handling", () => {
    expect(routeKey(win, key("KeyK", "ㅏ", { ctrlKey: true, isComposing: true }), false)).toEqual({ kind: "ime" });
    expect(routeKey(win, key("", "Process", { keyCode: 229 }), false)).toEqual({ kind: "ime" });
  });
});
