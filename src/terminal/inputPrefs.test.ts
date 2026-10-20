// SET-022 / SET-025 / SET-026: terminal options that carry a rule.
import { expect, test } from "vitest";
import { osc52On, osc52Save } from "./inputPrefs";
import { gpuMode, ligaturesOn, optionIsMeta, pastesOnMiddle, pickPowerShell, pointerHidden, preferGpu, readInput, shellCardShown, yenToBackslash } from "./inputPrefs";
import type { ShellEntry } from "./shellChoice";

const sh = (id: string): ShellEntry => ({ id, name: id, program: id, args: [] });

test("SET-022: ligatures and GPU start on automatic", () => {
  const p = readInput({}, "win32");
  expect(p.ligatures).toBe("auto");
  expect(p.gpu).toBe("auto");
  expect(readInput({ terminalLigatures: "nonsense" }, "win32").ligatures).toBe("auto");
});

test("SET-022: automatic ligatures follow the font, a saved choice wins", () => {
  expect(ligaturesOn("auto", "Fira Code")).toBe(true);
  expect(ligaturesOn("auto", "Cascadia Mono")).toBe(false);
  expect(ligaturesOn("auto", "")).toBe(false);
  expect(ligaturesOn("on", "Cascadia Mono")).toBe(true);
  expect(ligaturesOn("off", "Fira Code")).toBe(false);
});

test("SET-022: GPU drawing: off is off, on needs WebGL2, automatic also avoids a software renderer, an older false still means off", () => {
  expect(preferGpu("off", { webgl2: true, software: false })).toBe(false);
  expect(preferGpu("on", { webgl2: true, software: true })).toBe(true);
  expect(preferGpu("on", { webgl2: false, software: false })).toBe(false);
  expect(preferGpu("auto", { webgl2: true, software: true })).toBe(false);
  expect(preferGpu("auto", { webgl2: true, software: false })).toBe(true);
  expect(gpuMode({ terminalGpu: false })).toBe("off");
  expect(gpuMode({ terminalGpu: true })).toBe("on");
  expect(gpuMode({})).toBe("auto");
});

test("SET-025: middle-click paste is on for Linux and macOS and opt-in on Windows; OSC 52 is on; the rest start off", () => {
  expect(readInput({}, "linux").middleClick).toBe(true);
  expect(readInput({}, "darwin").middleClick).toBe(true);
  expect(readInput({}, "win32").middleClick).toBe(false);
  expect(readInput({ terminalMiddleClickPaste: true }, "win32").middleClick).toBe(true);
  const p = readInput({}, "win32");
  expect(p.osc52).toBe(true);
  expect(readInput({ terminalOsc52: false, terminalOsc52Chosen: true }, "win32").osc52).toBe(false); // VIEW-110: an off chosen on the current page
  expect([p.hidePointer, p.focusFollowsMouse, p.yenBackslash]).toEqual([false, false, false]);
  expect(p.optionAsAlt).toBe("auto");
});

test("SET-025: only the middle button pastes, and only when on", () => {
  const on = readInput({}, "linux");
  expect(pastesOnMiddle(on, 1)).toBe(true);
  expect(pastesOnMiddle(on, 0)).toBe(false);
  expect(pastesOnMiddle(readInput({}, "win32"), 1)).toBe(false);
});

test("SET-025: the full-screen scroll speed is corrected into range", () => {
  expect(readInput({}, "linux").fullScreenScroll).toBe(1);
  expect(readInput({ terminalFullScreenScroll: 0 }, "linux").fullScreenScroll).toBe(1);
  expect(readInput({ terminalFullScreenScroll: 99 }, "linux").fullScreenScroll).toBe(20);
  expect(readInput({ terminalFullScreenScroll: "x" }, "linux").fullScreenScroll).toBe(1);
  expect(readInput({ terminalFullScreenScroll: "" }, "linux").fullScreenScroll).toBe(1);
});

test("SET-025: Option acts as Alt only on macOS; automatic keeps it typing characters on layouts that use it", () => {
  const auto = readInput({}, "darwin");
  expect(optionIsMeta(auto, "darwin", false)).toBe(true);
  expect(optionIsMeta(auto, "darwin", true)).toBe(false);
  expect(optionIsMeta(readInput({ terminalOptionAsAlt: "on" }, "darwin"), "darwin", true)).toBe(true);
  expect(optionIsMeta(readInput({ terminalOptionAsAlt: "off" }, "darwin"), "darwin", false)).toBe(false);
  expect(optionIsMeta(readInput({ terminalOptionAsAlt: "on" }, "win32"), "win32", false)).toBe(false);
});

test("SET-025: the Yen key types a backslash only when switched on; the pointer hides only while typing and switched on", () => {
  expect(yenToBackslash(readInput({}, "win32"), "C:\u00a5x")).toBe("C:\u00a5x");
  expect(yenToBackslash(readInput({ terminalYenBackslash: true }, "win32"), "C:\u00a5x")).toBe("C:\\x");
  expect(pointerHidden(readInput({ terminalHidePointer: true }, "win32"), true)).toBe(true);
  expect(pointerHidden(readInput({ terminalHidePointer: true }, "win32"), false)).toBe(false);
  expect(pointerHidden(readInput({}, "win32"), true)).toBe(false);
});

test("SET-026: PowerShell version: automatic favours 7, a pick that is missing falls back, and the card is Windows only", () => {
  const both = [sh("powershell"), sh("pwsh")];
  expect(pickPowerShell(both, "auto")?.id).toBe("pwsh");
  expect(pickPowerShell(both, "5")?.id).toBe("powershell");
  expect(pickPowerShell(both, "7")?.id).toBe("pwsh");
  expect(pickPowerShell([sh("powershell")], "7")?.id).toBe("powershell");
  expect(pickPowerShell([], "auto")).toBeNull();
  expect(readInput({ powershellVersion: "9" }, "win32").powershell).toBe("auto");
  expect([shellCardShown("win32"), shellCardShown("darwin"), shellCardShown("linux")]).toEqual([true, false, false]);
});

test("VIEW-110: program clipboard access is on by default; an older saved off is overridden once, a chosen off stays", () => {
  expect(readInput({}, "win32").osc52).toBe(true);
  expect(readInput({ terminalOsc52: false }, "win32").osc52).toBe(true); // saved by an older build: overridden
  expect(readInput(osc52Save(false), "win32").osc52).toBe(false); // the user turned it off on the current page
  expect(readInput(osc52Save(true), "win32").osc52).toBe(true);
  expect(osc52On({ terminalOsc52: false, terminalOsc52Chosen: true })).toBe(false);
});
