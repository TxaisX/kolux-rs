import { describe, expect, it } from "vitest";
import { awakeToggle, stopCard } from "./stopCards";

describe("Explore Kolux stops carry their own setup cards (ONB-024)", () => {
  const f = (settings: Record<string, unknown> | null = {}, taskSource = false) => ({ taskSource, settings });
  it("tasks and PR view show GitHub, connected or not", () => {
    expect(stopCard("tasks", f({}, true))).toEqual({ kind: "provider", connected: true, label: "Tasks come from GitHub" });
    expect(stopCard("pr", f({}, false))).toEqual({ kind: "provider", connected: false, label: "Pull requests come from GitHub" });
  });
  it("agent statuses: keep-awake off turns on the automatic mode, and either on mode can be switched off", () => {
    expect(stopCard("statuses", f({ keepAwake: "off" }))).toEqual({ kind: "awake", mode: "off", on: false });
    expect(awakeToggle("off")).toBe("agent");
    expect(awakeToggle("agent")).toBe("off");
    expect(awakeToggle("on")).toBe("off");
    expect(stopCard("statuses", f({ keepAwake: "on" }))).toMatchObject({ mode: "on", on: true });
    expect(stopCard("statuses", f(null))).toMatchObject({ mode: "off", on: false });
  });
  it("ship shows the commit message writer settings", () => {
    expect(stopCard("ship", f({}))).toMatchObject({ kind: "writer", writer: { mode: "claude" } });
    expect(stopCard("ship", f({ commitWriter: "off" }))).toMatchObject({ writer: { mode: "off" } });
  });
  it("usage, orchestration and browser have no card yet (left to T-321-c)", () => {
    for (const id of ["usage", "orchestration", "browser", "terminal"]) expect(stopCard(id, f())).toBeNull();
  });
});
