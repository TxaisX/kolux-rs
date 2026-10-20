import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Council FIX-5: chordPlan and windowHasFocus with the window API stubbed, so the clock and the
// failure path can be driven from the test.
const isFocused = vi.fn<() => Promise<boolean>>();
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ isFocused }) }));

import { chordPlan, windowHasFocus } from "./chord";

beforeEach(() => {
  // The keyboard is inside the page: the app's own view does not have it, its window does.
  vi.stubGlobal("document", { hasFocus: () => false });
  isFocused.mockReset();
  isFocused.mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("BROW-003 chordPlan times the allowance with a clock that never steps back", () => {
  it("a wall-clock step back of an hour does not refuse the next real Ctrl+L", async () => {
    const wall = vi.spyOn(Date, "now");
    const mono = vi.spyOn(performance, "now");
    wall.mockReturnValue(5_000_000);
    mono.mockReturnValue(10_000);
    expect((await chordPlan(901, "focusAddressBar")).takeKeyboard).toBe(true);
    // Two seconds later on the monotonic clock; the system clock was set back by an hour meanwhile.
    wall.mockReturnValue(5_000_000 - 3_600_000);
    mono.mockReturnValue(12_000);
    expect((await chordPlan(901, "focusAddressBar")).takeKeyboard).toBe(true);
  });

  it("two real Ctrl+L inside one second on the monotonic clock: the second does not take the keyboard", async () => {
    const mono = vi.spyOn(performance, "now");
    mono.mockReturnValue(50_000);
    expect((await chordPlan(902, "focusAddressBar")).takeKeyboard).toBe(true);
    mono.mockReturnValue(50_400);
    expect(await chordPlan(902, "focusAddressBar")).toEqual({ focusPane: false, run: false, takeKeyboard: false });
  });

  it("Alt+Left then Ctrl+L at once: both act, the back does not use up the allowance", async () => {
    const mono = vi.spyOn(performance, "now");
    mono.mockReturnValue(70_000);
    expect(await chordPlan(903, "back")).toEqual({ focusPane: true, run: true, takeKeyboard: false });
    mono.mockReturnValue(70_050);
    expect(await chordPlan(903, "focusAddressBar")).toEqual({ focusPane: true, run: true, takeKeyboard: true });
  });
});

describe("BROW-003 windowHasFocus fails closed but says so", () => {
  it("a failed focus read gives false and is logged once, not swallowed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    isFocused.mockRejectedValue(new Error("ipc down"));
    expect(await windowHasFocus()).toBe(false);
    expect(await windowHasFocus()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0].join(" "))).toMatch(/ipc down/);
  });

  it("a page chord while the focus read fails moves nothing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    isFocused.mockRejectedValue(new Error("ipc down"));
    expect(await chordPlan(904, "focusAddressBar")).toEqual({ focusPane: false, run: false, takeKeyboard: false });
  });
});
