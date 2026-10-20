// SET-022 / SET-025 (T-247-d): the rules the pane applies from the input preferences.
import { expect, test } from "vitest";
import { applyInput, currentInput, inputOptions, loadLigatures, middlePastes, middleSource, optionTypesCharacters, probeGpu, softwareRenderer, watchPointer } from "./inputWire";
import { readInput } from "./inputPrefs";

test("SET-025: Option as Meta is a macOS rule; automatic keeps Option typing characters on a non-English layout", () => {
  const auto = readInput({}, "darwin");
  expect(inputOptions(auto, "darwin", "en-US", false, 1).macOptionIsMeta).toBe(true);
  expect(inputOptions(auto, "darwin", "de-DE", false, 1).macOptionIsMeta).toBe(false);
  expect(inputOptions(readInput({ terminalOptionAsAlt: "on" }, "darwin"), "darwin", "de-DE", false, 1).macOptionIsMeta).toBe(true);
  expect(inputOptions(readInput({ terminalOptionAsAlt: "on" }, "win32"), "win32", "en-US", false, 1).macOptionIsMeta).toBe(false);
  expect(optionTypesCharacters("en")).toBe(false);
  expect(optionTypesCharacters("sv-SE")).toBe(true);
});

test("SET-025: the wheel speed is the full-screen one only while a full-screen program holds the screen", () => {
  const p = readInput({ terminalFullScreenScroll: 7 }, "linux");
  expect(inputOptions(p, "linux", "en", true, 1.5).scrollSensitivity).toBe(7);
  expect(inputOptions(p, "linux", "en", false, 1.5).scrollSensitivity).toBe(1.5);
  expect(inputOptions(readInput({}, "linux"), "linux", "en", true, 1).scrollSensitivity).toBe(3);
});

test("SET-022: the ligatures addon comes back when it loads and null when it is absent or fails to start", async () => {
  class Fake {
    activate() {}
    dispose() {}
  }
  expect(await loadLigatures(async () => ({ LigaturesAddon: Fake }))).toBeInstanceOf(Fake);
  expect(await loadLigatures(() => Promise.reject(new Error("Cannot find module")))).toBeNull();
  expect(
    await loadLigatures(async () => ({
      LigaturesAddon: class {
        constructor() {
          throw new Error("no fonts here");
        }
      } as never,
    })),
  ).toBeNull();
  expect(await loadLigatures(async () => ({}) as never)).toBeNull();
});

test("SET-025: a middle click pastes only when switched on and the program is not tracking the mouse (Shift takes it back)", () => {
  const on = readInput({ terminalMiddleClickPaste: true }, "win32");
  expect(middlePastes(on, { button: 1, shiftKey: false }, "none")).toBe(true);
  expect(middlePastes(on, { button: 0, shiftKey: false }, "none")).toBe(false);
  expect(middlePastes(on, { button: 1, shiftKey: false }, "any")).toBe(false);
  expect(middlePastes(on, { button: 1, shiftKey: true }, "any")).toBe(true);
  expect(middlePastes(readInput({}, "win32"), { button: 1, shiftKey: false }, "none")).toBe(false);
  expect(middleSource("abc")).toBe("selection");
  expect(middleSource("")).toBe("clipboard");
});

type Fn = (e?: unknown) => void;
function fakeEl() {
  const on = new Map<string, Fn>();
  const classes = new Set<string>();
  const added: string[] = [];
  const doc = { createElement: () => ({ textContent: "" }), head: { appendChild: (n: unknown) => void added.push(String((n as { textContent: string }).textContent)) } };
  return {
    on,
    classes,
    added,
    el: {
      ownerDocument: doc,
      addEventListener: (t: string, f: Fn) => void on.set(t, f),
      removeEventListener: (t: string) => void on.delete(t),
      classList: { toggle: (c: string, f: boolean) => (f ? classes.add(c) : classes.delete(c)), remove: (c: string) => classes.delete(c) },
    } as never,
  };
}

test("SET-025: the pointer hides at the first key and shows at the next move; with the setting off it never hides", () => {
  const f = fakeEl();
  const prefs = readInput({ terminalHidePointer: true }, "linux");
  const stop = watchPointer(f.el, () => prefs);
  f.on.get("keydown")!();
  expect(f.classes.has("kolux-hide-pointer")).toBe(true);
  expect(f.added[0]).toContain("cursor: none");
  f.on.get("mousemove")!();
  expect(f.classes.size).toBe(0);
  f.on.get("keydown")!();
  stop();
  expect(f.classes.size).toBe(0);
  expect(f.on.size).toBe(0);

  const g = fakeEl();
  watchPointer(g.el, () => readInput({}, "linux"));
  g.on.get("keydown")!();
  expect(g.classes.size).toBe(0);
});

test("SET-022: a software WebGL renderer is told apart; a machine without WebGL2 reports none", () => {
  expect(softwareRenderer("Google SwiftShader")).toBe(true);
  expect(softwareRenderer("llvmpipe (LLVM 15)")).toBe(true);
  expect(softwareRenderer("NVIDIA GeForce RTX 4070")).toBe(false);
  const doc = { createElement: () => ({ getContext: () => null }) } as never;
  expect(probeGpu(doc)).toEqual({ webgl2: false, software: false });
  const gl = { getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 1 }), getParameter: () => "ANGLE (Intel, SwiftShader)" };
  expect(probeGpu({ createElement: () => ({ getContext: () => gl }) } as never)).toEqual({ webgl2: true, software: true });
  expect(probeGpu({ createElement: () => { throw new Error("no canvas"); } } as never)).toEqual({ webgl2: false, software: false });
});

test("SET-022: applying the settings replaces what the panes read", () => {
  applyInput({ terminalHidePointer: true, terminalFullScreenScroll: 9 }, "linux");
  expect(currentInput().hidePointer).toBe(true);
  expect(currentInput().fullScreenScroll).toBe(9);
  applyInput(null, "linux");
  expect(currentInput().hidePointer).toBe(false);
});
