import { describe, expect, it } from "vitest";
import { aboutRows, gpuText } from "./about";

describe("view-106 About panel", () => {
  it("puts Safe Graphics Mode ahead of the browser engine's GPU status, and says so when it is on", () => {
    const rows = aboutRows({ version: "0.1.0", safeGraphics: true, gpu: { webgl2: true, software: true } });
    expect(rows.map((r) => r.label)).toEqual(["Version", "Safe Graphics Mode", "Graphics (browser engine)"]);
    expect(rows[1].value).toMatch(/^on/);
    expect(rows[2].value).toBe("software drawing");
  });
  it("anything not known yet says unavailable", () => {
    const rows = aboutRows({ version: "", safeGraphics: null, gpu: null });
    expect(rows.map((r) => r.value)).toEqual(["unavailable", "unavailable", "unavailable"]);
  });
  it("reads the three GPU states", () => {
    expect(gpuText({ webgl2: true, software: false })).toBe("hardware accelerated");
    expect(gpuText({ webgl2: false, software: false })).toMatch(/WebGL 2 is not available/);
  });
});
