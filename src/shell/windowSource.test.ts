// Cycle 3 (the WindowView split): the source-test file list, guarded. The window's drawing is a folder
// (shell/window) and the source tests read it through shell/windowSource.ts; every module there must be
// in that text, so a surface moved out of WindowView.tsx joins by existing. The window's files outside
// the folder are one named list, with a count that fails when a rename drops one. This is the check that
// stops a module quietly leaving paneStatus, paneMark, commands, savedLaunch, noticeMount, explorerBar
// or main.slowStart after the next split.
import { expect, test } from "vitest";
import { windowFiles, windowSource } from "./windowSource";

/** The drawing folder as the source list globs it (the same pattern, so a file cannot hide from both). */
const DRAWING = import.meta.glob(["./window/*.{ts,tsx}", "!./window/*.test.ts", "!./window/*.test.tsx", "!./window/__cards__/**"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const rel = (k: string) => `./shell/${k.replace(/^\.\//, "")}`;

test("the window's drawing folder joins the source tests whole", () => {
  expect(Object.keys(DRAWING).length).toBeGreaterThanOrEqual(10);
  for (const [file, text] of Object.entries(DRAWING)) {
    expect(windowFiles[rel(file)], `${file} is in the window's source list`).toBe(text);
    expect(windowSource, `${file} reaches the text the source tests read`).toContain(text);
  }
});

test("the window's files outside the drawing folder are all present, so a rename cannot quietly drop one", () => {
  // App.tsx + WindowView.tsx + the 6 shell files beside it + the 14 hooks the App.tsx split made.
  expect(Object.keys(windowFiles).filter((f) => !f.startsWith("./shell/window/"))).toHaveLength(21);
  for (const f of ["./App.tsx", "./shell/WindowView.tsx", "./shell/windowStore.ts", "./shell/windowBag.ts", "./shell/useWindowSave.ts", "./settings/useSettingsPlumbing.ts"]) {
    expect(windowFiles[f], f).toBeTruthy();
  }
});

test("every module WindowView.tsx imports joins the scan", () => {
  const view = windowFiles["./shell/WindowView.tsx"];
  const specs = [...view.matchAll(/from "(\.[^"]+)"/g)].map((m) => m[1]).filter((s) => s.startsWith("./"));
  expect(specs.length).toBeGreaterThan(3);
  for (const spec of specs) {
    const base = `./shell/${spec.replace(/^\.\//, "")}`;
    expect(Object.keys(windowFiles).some((f) => f === `${base}.tsx` || f === `${base}.ts`), spec).toBe(true);
  }
});
