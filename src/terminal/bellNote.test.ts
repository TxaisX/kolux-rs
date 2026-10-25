import { describe, expect, it } from "vitest";
import { KINDS } from "../settings/notifications";
import { BELL_NOTE, bellGate } from "./bellNote";

describe("T-125-b the terminal bell", () => {
  it("raises its own kind: the bell switch, not the finish switch", () => {
    expect(BELL_NOTE.gate).toBe("notifyBell");
    expect(KINDS.map((k) => k.key)).toContain(BELL_NOTE.gate);
    expect(KINDS.find((k) => k.key === BELL_NOTE.gate)?.label).toMatch(/bell/i);
  });

  it("lets one bell through per gap and the next after it", () => {
    let t = 1000;
    const gate = bellGate(2000, () => t);
    expect(gate()).toBe(true);
    t = 1500;
    expect(gate()).toBe(false); // a looping program
    t = 2999;
    expect(gate()).toBe(false);
    t = 3000;
    expect(gate()).toBe(true);
  });

  it("each pane has its own gap", () => {
    const a = bellGate(2000, () => 5);
    const b = bellGate(2000, () => 5);
    expect(a()).toBe(true);
    expect(b()).toBe(true);
  });
});
