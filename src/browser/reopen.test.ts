import { describe, expect, it } from "vitest";
import src from "./BrowserPane.tsx?raw";
import { type Call, namesPane, type Opening, openPage, reopenPage } from "./reopen";

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
      ["browser_pane_ready", { id: 7 }],
    ]);
  });

  it("opens even when the close fails (the page is already gone)", async () => {
    const calls: string[] = [];
    const call: Call = async (cmd) => {
      calls.push(cmd);
      if (cmd === "browser_close") throw new Error("no such page");
    };
    await reopenPage(call, 3, at);
    expect(calls).toEqual(["browser_close", "browser_open", "browser_pane_ready"]);
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
    expect(calls.map((c) => c[0])).toEqual(["browser_close", "browser_open", "browser_pane_ready"]);
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

describe("after-list 719: the pane says it is up once its page is open", () => {
  it("the mount's open is followed by browser_pane_ready for that tab, in that order", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    await openPage(async (cmd, args) => void calls.push([cmd, args]), 4, { url: "https://example.com/", shown: true });
    expect(calls).toEqual([
      ["browser_open", { id: 4, url: "https://example.com/", shown: true }],
      ["browser_pane_ready", { id: 4 }],
    ]);
  });

  it("an open that fails never announces the pane", async () => {
    const calls: string[] = [];
    const call: Call = async (cmd) => {
      calls.push(cmd);
      if (cmd === "browser_open") throw new Error("cannot open");
    };
    await expect(openPage(call, 4, {})).rejects.toThrow("cannot open");
    expect(calls).toEqual(["browser_open"]);
  });

  it("a failed announcement is not an error (an older back end has no such command)", async () => {
    const call: Call = async (cmd) => {
      if (cmd === "browser_pane_ready") throw new Error("unknown command");
    };
    await expect(openPage(call, 4, {})).resolves.toBeUndefined();
  });

  it("a rebuild announces again", async () => {
    const calls: string[] = [];
    await reopenPage(async (cmd) => void calls.push(cmd), 2, at);
    expect(calls[calls.length - 1]).toBe("browser_pane_ready");
  });
});

describe("after-list 719: BrowserPane uses the announcing open", () => {
  it("the pane's mount opens through openPage, never a bare browser_open", () => {
    expect(src).toMatch(/await openPage\(invoke, id,/);
    expect(src).not.toMatch(/invoke\("browser_open"/);
  });
});
