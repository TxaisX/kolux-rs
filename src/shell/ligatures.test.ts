import { describe, expect, it, vi } from "vitest";
import { loadLigatures } from "../terminal/inputWire";
import { ligaturesOn } from "../terminal/inputPrefs";
import { afterLigatures, importLigatures } from "./ligatures";

// The package names only a browser entry ("module"); vite's browser build takes it, while vitest
// in node looks for "main", which the package does not ship. Point the literal name at that same
// browser entry so these tests run the real addon code.
vi.mock(
  "@xterm/addon-ligatures",
  // @ts-expect-error the browser entry ships no declaration file of its own (the package typings cover the name)
  () => import("@xterm/addon-ligatures/lib/addon-ligatures.mjs"),
);

type Joiner = (text: string) => [number, number][];

/** The parts of a terminal the addon touches when it is switched on and off. */
function fakeTerminal() {
  const joiners = new Map<number, Joiner>();
  let next = 1;
  return {
    joiners,
    element: { style: { fontFeatureSettings: "" } },
    options: { fontFamily: "Fira Code, monospace" },
    registerCharacterJoiner(j: Joiner) {
      joiners.set(next, j);
      return next++;
    },
    deregisterCharacterJoiner(id: number) {
      joiners.delete(id);
    },
  };
}

describe("TERM-102 ligatures with the approved addon", () => {
  it("imports the installed package by its literal name", async () => {
    const mod = await importLigatures();
    expect(typeof mod.LigaturesAddon).toBe("function");
  });

  it("the pane's guarded loader now gives a real addon instead of plain text", async () => {
    const addon = await loadLigatures(importLigatures);
    expect(addon).not.toBeNull();
    addon?.dispose();
  });

  it("joins arrows and comparisons, turns the font's calt on, and undoes both when switched off", async () => {
    const addon = await loadLigatures(importLigatures);
    const term = fakeTerminal();
    addon!.activate(term as never);
    expect(term.element.style.fontFeatureSettings).toBe('"calt" on');
    expect(term.joiners.size).toBe(1);
    const join = [...term.joiners.values()][0];
    expect(join("a -> b")).toEqual([[2, 4]]);
    expect(join("x !== y")).toEqual([[2, 5]]);
    expect(join("plain words")).toEqual([]);
    addon!.dispose();
    expect(term.joiners.size).toBe(0);
    expect(term.element.style.fontFeatureSettings).toBe("");
  });

  it("is on automatically only for known ligature fonts (the rule the pane asks first)", () => {
    expect(ligaturesOn("auto", "Fira Code")).toBe(true);
    expect(ligaturesOn("auto", "JetBrains Mono, monospace")).toBe(true);
    expect(ligaturesOn("auto", "Consolas")).toBe(false);
    expect(ligaturesOn("on", "Consolas")).toBe(true);
    expect(ligaturesOn("off", "Fira Code")).toBe(false);
  });

  it("redraws after a switch: the GPU glyph cache is cleared and every row repainted", () => {
    const renderer = { clearGlyphs: vi.fn() };
    const term = { rows: 24, refresh: vi.fn() };
    afterLigatures(renderer, term);
    expect(renderer.clearGlyphs).toHaveBeenCalledOnce();
    expect(term.refresh).toHaveBeenCalledWith(0, 23);
    afterLigatures({ clearGlyphs: () => { throw new Error("context lost"); } }, term);
    expect(term.refresh).toHaveBeenCalledTimes(2);
  });
});
