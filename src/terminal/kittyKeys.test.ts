// TERM-082 / VIEW-109 / TERM-086 (T-306): expected bytes are the examples and tables of the public kitty keyboard
// protocol spec (https://sw.kovidgoyal.net/kitty/keyboard-protocol/).
import { describe, expect, it } from "vitest";
import { chordsOf, defaultsOnly } from "../keys/keymap";
import { encodeKitty, INPUT_SOURCE_ACTION, KITTY, KITTY_STACK_CAP, KittyKeyboard, latinControl, type KittyKey } from "./kittyKeys";
import { routeKey } from "./shellKeys";

const k = (key: string, code: string, extra: Partial<KittyKey> = {}): KittyKey => ({ type: "keydown", key, code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...extra });
const D = KITTY.disambiguate;
const CSI = "\x1b[";

describe("TERM-082 key encoding", () => {
  it("is off with no flags: every key stays xterm's", () => {
    expect(encodeKitty(k("Escape", "Escape"), 0)).toBeNull();
    expect(encodeKitty(k("1", "Digit1", { altKey: true }), 0)).toBeNull();
  });
  it("Alt (Option) + digit arrives as an encoded key, not a symbol", () => {
    expect(encodeKitty(k("1", "Digit1", { altKey: true }), D)).toBe(`${CSI}49;3u`);
  });
  it("Escape, Ctrl and Alt combos are disambiguated", () => {
    expect(encodeKitty(k("Escape", "Escape"), D)).toBe(`${CSI}27u`);
    expect(encodeKitty(k("c", "KeyC", { ctrlKey: true }), D)).toBe(`${CSI}99;5u`);
    expect(encodeKitty(k("[", "BracketLeft", { altKey: true }), D)).toBe(`${CSI}91;3u`);
    expect(encodeKitty(k("x", "KeyX", { ctrlKey: true, altKey: true }), D)).toBe(`${CSI}120;7u`);
  });
  it("Shift+Enter reaches the program; plain Enter, Tab and Backspace keep their legacy bytes", () => {
    expect(encodeKitty(k("Enter", "Enter", { shiftKey: true }), D)).toBe(`${CSI}13;2u`);
    expect(encodeKitty(k("Tab", "Tab", { shiftKey: true }), D)).toBe(`${CSI}9;2u`);
    expect(encodeKitty(k("Enter", "Enter"), D)).toBeNull();
    expect(encodeKitty(k("Backspace", "Backspace"), D)).toBeNull();
    expect(encodeKitty(k("Enter", "Enter"), D | KITTY.allAsEscapes)).toBe(`${CSI}13u`);
  });
  it("plain text stays text unless every key is an escape code", () => {
    expect(encodeKitty(k("a", "KeyA"), D)).toBeNull();
    expect(encodeKitty(k("A", "KeyA", { shiftKey: true }), D)).toBeNull();
    expect(encodeKitty(k("a", "KeyA"), KITTY.allAsEscapes)).toBe(`${CSI}97u`);
  });
  it("shift+a with all keys and associated text, then with alternate keys (the spec's examples)", () => {
    const A = k("A", "KeyA", { shiftKey: true });
    expect(encodeKitty(A, KITTY.allAsEscapes | KITTY.associatedText)).toBe(`${CSI}97;2;65u`);
    expect(encodeKitty(A, KITTY.allAsEscapes | KITTY.associatedText | KITTY.alternateKeys)).toBe(`${CSI}97:65;2;65u`);
  });
  it("a shifted symbol's number is its unshifted key; the shifted key rides along as the alternate", () => {
    expect(encodeKitty(k("!", "Digit1", { ctrlKey: true, shiftKey: true }), D | KITTY.alternateKeys)).toBe(`${CSI}49:33;6u`);
  });
  it("arrows and function keys: legacy when unmodified, the spec's numbers when modified", () => {
    expect(encodeKitty(k("ArrowUp", "ArrowUp"), D)).toBeNull();
    expect(encodeKitty(k("ArrowUp", "ArrowUp", { ctrlKey: true }), D)).toBe(`${CSI}1;5A`);
    expect(encodeKitty(k("F3", "F3", { shiftKey: true }), D)).toBe(`${CSI}13;2~`);
    expect(encodeKitty(k("PageDown", "PageDown", { altKey: true }), D)).toBe(`${CSI}6;3~`);
    expect(encodeKitty(k("F1", "F1"), KITTY.allAsEscapes)).toBe(`${CSI}P`);
    expect(encodeKitty(k("F13", "F13", { shiftKey: true }), D)).toBe(`${CSI}57376;2u`);
  });
  it("event types: repeat and release carry :2 and :3; Enter has no release without all keys", () => {
    const f = D | KITTY.eventTypes;
    expect(encodeKitty(k("a", "KeyA", { ctrlKey: true, repeat: true }), f)).toBe(`${CSI}97;5:2u`);
    expect(encodeKitty(k("a", "KeyA", { type: "keyup" }), f)).toBe(`${CSI}97;1:3u`);
    expect(encodeKitty(k("Enter", "Enter", { type: "keyup" }), f)).toBe("");
    expect(encodeKitty(k("a", "KeyA", { type: "keyup" }), D)).toBe("");
  });
  it("modifier keys and keypad keys only when every key is an escape code, left and right apart", () => {
    expect(encodeKitty(k("Shift", "ShiftLeft", { shiftKey: true }), D)).toBeNull();
    expect(encodeKitty(k("Shift", "ShiftLeft", { shiftKey: true }), KITTY.allAsEscapes)).toBe(`${CSI}57441;2u`);
    expect(encodeKitty(k("Alt", "AltRight", { altKey: true }), KITTY.allAsEscapes)).toBe(`${CSI}57449;3u`);
    expect(encodeKitty(k("5", "Numpad5"), KITTY.allAsEscapes)).toBe(`${CSI}57404u`);
    expect(encodeKitty(k("5", "Numpad5"), D)).toBeNull();
  });
  it("lock modifiers are reported only with all keys as escape codes", () => {
    expect(encodeKitty(k("a", "KeyA", { ctrlKey: true, capsLock: true }), D)).toBe(`${CSI}97;5u`);
    expect(encodeKitty(k("a", "KeyA", { capsLock: true }), KITTY.allAsEscapes)).toBe(`${CSI}97;65u`);
  });
  it("a dead key, an input-method key and AltGr typing are never encoded, so accented characters still compose", () => {
    expect(encodeKitty(k("Dead", "BracketLeft"), D | KITTY.allAsEscapes)).toBeNull();
    expect(encodeKitty(k("e", "KeyE", { isComposing: true, ctrlKey: true }), D)).toBeNull();
    expect(encodeKitty(k("x", "KeyX", { keyCode: 229, altKey: true }), D)).toBeNull();
    expect(encodeKitty(k("@", "KeyQ", { ctrlKey: true, altKey: true, altGraph: true }), D)).toBeNull();
  });
  it("a non-Latin layout: the layout's key is the number, the Latin key is the base-layout alternate", () => {
    expect(encodeKitty(k("с", "KeyC", { ctrlKey: true }), D | KITTY.alternateKeys)).toBe(`${CSI}1089::99;5u`);
  });
});

describe("TERM-082 flag stacks", () => {
  it("query, push, pop and the per-screen stacks", () => {
    const kb = new KittyKeyboard();
    expect(kb.apply("?", [], false)).toBe(`${CSI}?0u`);
    kb.apply(">", [1], false);
    kb.apply(">", [3], false);
    expect(kb.apply("?", [], false)).toBe(`${CSI}?3u`);
    expect(kb.flags(true)).toBe(0); // the alternate screen keeps its own stack
    kb.apply("<", [], false);
    expect(kb.flags(false)).toBe(1);
    kb.apply("<", [5], false);
    expect(kb.flags(false)).toBe(0);
  });
  it("set, or-in and clear bits with CSI = flags ; mode u; a pop that empties resets everything", () => {
    const kb = new KittyKeyboard();
    kb.apply("=", [1], false);
    kb.apply("=", [8, 2], false);
    expect(kb.flags(false)).toBe(9);
    kb.apply("=", [1, 3], false);
    expect(kb.flags(false)).toBe(8);
    kb.apply(">", [1], false);
    kb.apply("<", [1], false);
    expect(kb.flags(false)).toBe(0);
  });
  it("a push past the cap evicts the oldest entry", () => {
    const kb = new KittyKeyboard();
    for (let i = 1; i <= KITTY_STACK_CAP + 1; i++) kb.apply(">", [i % 2 ? 1 : 3], false);
    kb.apply("<", [KITTY_STACK_CAP - 1], false);
    expect(kb.flags(false)).toBe(3); // entry 2 of 17 is the bottom now (entry 1 was evicted)
  });
  it("VIEW-109: the program ends -> the protocol is off and keys go back to legacy", () => {
    const kb = new KittyKeyboard();
    kb.apply(">", [1], true);
    expect(kb.encode(k("Escape", "Escape"), true)).toBe(`${CSI}27u`);
    kb.reset();
    expect(kb.flags(true)).toBe(0);
    expect(kb.encode(k("Escape", "Escape"), true)).toBeNull();
  });
  it("a release goes out only for a key whose press reached the program while event types were on", () => {
    const kb = new KittyKeyboard();
    kb.apply(">", [D | KITTY.eventTypes], false);
    expect(kb.encode(k("b", "KeyB", { type: "keyup" }), false)).toBeNull();
    expect(kb.encode(k("b", "KeyB"), false)).toBeNull(); // plain text press: xterm types it
    expect(kb.encode(k("b", "KeyB", { type: "keyup" }), false)).toBe(`${CSI}98;1:3u`);
  });
});

describe("TERM-086 control keys on non-Latin layouts", () => {
  it("Ctrl+C on Russian and Ctrl+D on Greek send the Latin control bytes", () => {
    expect(latinControl(k("с", "KeyC", { ctrlKey: true }))).toBe("\x03");
    expect(latinControl(k("δ", "KeyD", { ctrlKey: true }))).toBe("\x04");
    expect(latinControl(k("х", "BracketLeft", { ctrlKey: true }))).toBe("\x1b");
  });
  it("a Latin layout, other modifiers and AltGr are left to xterm", () => {
    expect(latinControl(k("c", "KeyC", { ctrlKey: true }))).toBeNull();
    expect(latinControl(k("с", "KeyC", { ctrlKey: true, altKey: true }))).toBeNull();
    expect(latinControl(k("с", "KeyC"))).toBeNull();
  });
});

describe("TERM-085 switch input source", () => {
  it("ships unbound, so an ordinary chord is never taken as input-source switching", () => {
    for (const p of ["win32", "darwin", "linux"] as const) expect(chordsOf(defaultsOnly(p), INPUT_SOURCE_ACTION)).toEqual([]);
    // Ctrl+Space and Alt+Shift (the usual OS layout chords) reach the program untouched.
    expect(routeKey(defaultsOnly("win32"), k(" ", "Space", { ctrlKey: true }), false)).toEqual({ kind: "shell" });
    expect(routeKey(defaultsOnly("win32"), k("Shift", "ShiftLeft", { altKey: true, shiftKey: true }), false)).toEqual({ kind: "shell" });
  });
});
