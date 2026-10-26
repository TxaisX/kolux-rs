import { describe, expect, it } from "vitest";
import { liveTerminals, waitingTabs, type Call } from "./waitingScan";

const prompt = { kind: "approval", text: "Allow?", options: [] };

describe("floating panel waiting scan (after-list row 141)", () => {
  it("lists the tabs whose screen shows an open prompt and asks Rust per terminal", async () => {
    const asked: unknown[] = [];
    const call: Call = async (cmd, args) => (asked.push([cmd, args]), (args.terminal as number) === 7 ? { prompt, changed: true } : { prompt: null, changed: false });
    expect(await waitingTabs(call, { 1000001: 7, 1000002: 8 })).toEqual([1000001]);
    expect(asked).toEqual([
      ["prompt_scan", { paneKey: 1000001, terminal: 7 }],
      ["prompt_scan", { paneKey: 1000002, terminal: 8 }],
    ]);
  });

  it("counts nothing when no tab waits, when a scan fails, or when there is no terminal", async () => {
    const call: Call = async (_c, args) => {
      if (args.terminal === 9) throw new Error("gone");
      return { prompt: null, changed: false };
    };
    expect(await waitingTabs(call, { 1000001: 8, 1000002: 9 })).toEqual([]);
    expect(await waitingTabs(call, {})).toEqual([]);
  });

  it("leaves out the tab whose program ended", () => {
    const tabs = [{ key: 1000001 }, { key: 1000002, exited: true }, { key: 1000003 }];
    expect(liveTerminals({ 1000001: 7, 1000002: 8 }, tabs)).toEqual({ 1000001: 7 });
  });
});
