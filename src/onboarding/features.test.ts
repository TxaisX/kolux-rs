import { describe, expect, it, vi } from "vitest";
import { featureMemory } from "./features";
import { demoFrames, DEMO_TEXT, paletteKeys } from "./guide";
import { defaultsOnly, labelOf, resolve } from "../keys/keymap";

describe("feature memory (ONB-042)", () => {
  it("nothing is recorded until the saved record has loaded", () => {
    const send = vi.fn(() => Promise.resolve());
    const m = featureMemory(send);
    expect(m.note("split")).toBe(false);
    expect(m.used("split")).toBe(false);
    m.loaded(undefined);
    expect(m.note("split")).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("split");
    expect(m.used("split")).toBe(true);
  });

  it("has-used answers from the loaded record, counts only go up and a failed send stays silent", () => {
    const m = featureMemory(() => Promise.reject(new Error("disk")));
    m.loaded({ board: { first: 5, count: 2 } });
    expect([m.used("board"), m.used("tasks")]).toEqual([true, false]);
    expect(m.note("board", 99)).toBe(true);
    expect(m.used("board")).toBe(true);
  });
});

describe("command palette tip (ONB-029)", () => {
  it("the key chips follow the user's binding; an unassigned binding falls back to the default", () => {
    const fallback = labelOf(defaultsOnly("win32"), "worktree.palette");
    expect(fallback.length).toBeGreaterThan(1);
    const rebound = resolve({ version: 1, keybindings: { "worktree.palette": "Mod+Alt+P" } }, "win32");
    const mine = labelOf(rebound, "worktree.palette");
    expect(mine).not.toEqual(fallback);
    expect(paletteKeys(mine, fallback)).toEqual(mine);
    expect(paletteKeys([], fallback)).toEqual(fallback);
    expect(fallback.some((p) => p.includes("⌘") || p === "Cmd")).toBe(false);
  });

  it("the demo types the name, ends on the create-workspace row and plays once", () => {
    const f = demoFrames(false);
    expect(f[0]).toEqual({ typed: "", create: false });
    expect(f[f.length - 1]).toEqual({ typed: DEMO_TEXT, create: true });
    expect(f.filter((x) => x.create)).toHaveLength(1);
  });

  it("with reduced motion the demo is only its end state", () => {
    expect(demoFrames(true)).toEqual([{ typed: DEMO_TEXT, create: true }]);
  });
});
