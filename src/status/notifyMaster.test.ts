import { describe, expect, it } from "vitest";
import { hasSystemPanel, masterOn, quietMinutes, testOutcome, usageAlertsAllowed } from "./notifyMaster";

describe("STAT-042 master switch", () => {
  it("is on unless saved off", () => {
    expect(masterOn({})).toBe(true);
    expect(masterOn({ notificationsOn: "no" })).toBe(true);
    expect(masterOn({ notificationsOn: false })).toBe(false);
  });

  it("reads a missing quiet threshold as 10 and holds a saved one to 0..600", () => {
    expect(quietMinutes({})).toBe(10);
    expect(quietMinutes({ quietMinutes: 0 })).toBe(0);
    expect(quietMinutes({ quietMinutes: 12.7 })).toBe(12);
    expect(quietMinutes({ quietMinutes: 9999 })).toBe(600);
    expect(quietMinutes({ quietMinutes: "5" })).toBe(10);
  });

  it("holds usage alerts back while either switch is off", () => {
    const alertsOn = (s: Record<string, unknown>) => s.usageAlerts !== false;
    expect(usageAlertsAllowed({}, alertsOn)).toBe(true);
    expect(usageAlertsAllowed({ usageAlerts: false }, alertsOn)).toBe(false);
    expect(usageAlertsAllowed({ notificationsOn: false }, alertsOn)).toBe(false);
  });
});

describe("STAT-042 test outcome", () => {
  it("confirms a test the system showed", () => {
    expect(testOutcome({ shown: true, blocked: false }, "Win32")).toEqual({ kind: "shown" });
  });

  it("offers Open Settings on Windows and macOS when the test was not shown", () => {
    const w = testOutcome({ shown: false, blocked: true }, "Win32");
    expect(w.kind === "failed" && w.openSettings).toBe(true);
    expect(w.kind === "failed" && w.text).toMatch(/switched off/);
    const m = testOutcome({ error: "denied" }, "MacIntel");
    expect(m.kind === "failed" && m.openSettings).toBe(true);
    expect(m.kind === "failed" && m.text).toMatch(/denied/);
  });

  it("says the platform is not supported elsewhere", () => {
    const l = testOutcome({ shown: false, blocked: false }, "Linux x86_64");
    expect(l).toEqual({ kind: "failed", text: expect.stringMatching(/not supported/), openSettings: false });
    expect(hasSystemPanel("Linux x86_64")).toBe(false);
    expect(hasSystemPanel("Win32")).toBe(true);
  });
});
