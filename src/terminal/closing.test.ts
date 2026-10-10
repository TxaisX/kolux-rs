import { describe, expect, it } from "vitest";
import { asksBeforeClose, busyCount, closeQuestion } from "./closing";

describe("TERM-045 close confirmation", () => {
  it("asks unless the setting is off", () => {
    expect(asksBeforeClose({})).toBe(true);
    expect(asksBeforeClose({ confirmCloseRunning: true })).toBe(true);
    expect(asksBeforeClose({ confirmCloseRunning: false })).toBe(false);
  });

  it("counts busy panes, and a failed check counts none", async () => {
    expect(await busyCount([1, 2, 3], async () => [true, false, true])).toBe(2);
    expect(await busyCount([1], async () => [false])).toBe(0);
    expect(await busyCount([1], async () => Promise.reject(new Error("no")))).toBe(0);
    expect(await busyCount([], async () => [true])).toBe(0);
  });

  it("names the tab, and a split tab gets one question for all its panes", () => {
    expect(closeQuestion("api", 1, 1)).toEqual({ title: "Close “api”?", body: "A program is still running in it. Closing the tab stops it." });
    expect(closeQuestion("api", 2, 2).body).toBe("A program is still running in 2 of its 2 panes. Closing the tab stops them.");
  });
});
