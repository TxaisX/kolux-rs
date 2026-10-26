import { describe, expect, it } from "vitest";
import { type Call, namesPane, type Opening, reopenPage } from "./reopen";

const at: Opening = { url: "https://example.com/", spot: { x: 10, y: 40, w: 800, h: 600 }, background: [18, 18, 20], shown: true };

describe("BROW-009: reopenPage rebuilds the tab's page", () => {
  it("closes the page, then opens it again with the pane's spot, colour and address", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const call: Call = async (cmd, args) => {
      calls.push([cmd, args]);
    };
    await reopenPage(call, 7, at);
    expect(calls).toEqual([
      ["browser_close", { id: 7 }],
      ["browser_open", { id: 7, url: "https://example.com/", spot: at.spot, background: [18, 18, 20], shown: true }],
    ]);
  });

  it("opens even when the close fails (the page is already gone)", async () => {
    const calls: string[] = [];
    const call: Call = async (cmd) => {
      calls.push(cmd);
      if (cmd === "browser_close") throw new Error("no such page");
    };
    await reopenPage(call, 3, at);
    expect(calls).toEqual(["browser_close", "browser_open"]);
  });

  it("an open that fails rejects, so the pane can show why", async () => {
    const call: Call = async (cmd) => {
      if (cmd === "browser_open") throw new Error("cannot open");
    };
    await expect(reopenPage(call, 3, at)).rejects.toThrow("cannot open");
  });
});

describe("T-241 (BROW-045): a profile change reopens the pane's page in the new profile", () => {
  it("only the pane the event names reopens", () => {
    expect(namesPane({ page: 7, profile: "work" }, 7)).toBe(true);
    expect(namesPane({ page: 7, profile: "work" }, 8)).toBe(false);
  });

  it("closes the page and opens it again on its address with the new profile", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const call: Call = async (cmd, args) => {
      calls.push([cmd, args]);
    };
    await reopenPage(call, 7, { ...at, url: "https://example.com/inbox", profile: "work" });
    expect(calls.map((c) => c[0])).toEqual(["browser_close", "browser_open"]);
    expect(calls[1][1]).toMatchObject({ id: 7, url: "https://example.com/inbox", profile: "work", spot: at.spot, background: [18, 18, 20] });
  });

  it("a profile deleted under the tab sends it back to the default profile", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    await reopenPage(async (cmd, args) => void calls.push([cmd, args]), 7, { ...at, profile: "default" });
    expect(calls[1][1].profile).toBe("default");
  });

  it("a plain rebuild names no profile, so the engine's own rules apply", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    await reopenPage(async (cmd, args) => void calls.push([cmd, args]), 7, at);
    expect("profile" in calls[1][1]).toBe(false);
  });
});
