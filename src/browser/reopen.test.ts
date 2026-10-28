import { describe, expect, it } from "vitest";
import src from "./BrowserPane.tsx?raw";
import { type Call, namesPane, type Opening, openFirstPage, openPage, reopenPage, takesBarFocus } from "./reopen";
import { fresh, overlayModel, overlayOf, step } from "./loadState";

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
      ["browser_open", { id: 7, url: "https://example.com/", spot: at.spot, background: [18, 18, 20], shown: true, rebuild: "auto" }],
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

describe("row 954c H1/H3: a rebuild says why, so the back end keeps the profile and never takes focus", () => {
  it("Retry rebuilds with the word retry, the pane's own recovery with auto", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const call: Call = async (cmd, args) => void calls.push([cmd, args]);
    await reopenPage(call, 7, at, "retry");
    expect(calls[1][1].rebuild).toBe("retry");
    calls.length = 0;
    await reopenPage(call, 7, at);
    expect(calls[1][1].rebuild).toBe("auto");
  });

  it("a first open names no rebuild", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    await openPage(async (cmd, args) => void calls.push([cmd, args]), 4, { url: "https://example.com/", shown: true });
    expect("rebuild" in calls[0][1]).toBe(false);
  });
});

describe("row 954c H5: a rebuild that outlives its pane, and one that finishes while the pane changed", () => {
  const record = () => {
    const calls: [string, Record<string, unknown>][] = [];
    return { calls, call: (async (cmd, args) => void calls.push([cmd, args])) as Call };
  };

  it("a pane gone after the close opens nothing", async () => {
    const { calls, call } = record();
    await reopenPage(call, 7, at, "auto", { alive: () => false, sync: () => calls.push(["sync", {}]) });
    expect(calls.map((c) => c[0])).toEqual(["browser_close"]);
  });

  it("a pane gone during the open closes the page it just built, and does not sync", async () => {
    const { calls, call } = record();
    let alive = true;
    const slow: Call = async (cmd, args) => {
      await call(cmd, args);
      if (cmd === "browser_open") alive = false;
    };
    await reopenPage(slow, 7, at, "auto", { alive: () => alive, sync: () => calls.push(["sync", {}]) });
    expect(calls.map((c) => c[0])).toEqual(["browser_close", "browser_open", "browser_pane_ready", "browser_close"]);
  });

  it("a live pane has its CURRENT bounds applied after the page exists, before anything else", async () => {
    const { calls, call } = record();
    await reopenPage(call, 7, at, "auto", { alive: () => true, sync: () => calls.push(["sync", {}]) });
    expect(calls.map((c) => c[0])).toEqual(["browser_close", "browser_open", "browser_pane_ready", "sync"]);
  });

  it("an open that fails still rejects, and syncs nothing", async () => {
    const { calls } = record();
    const call: Call = async (cmd) => {
      if (cmd === "browser_open") throw new Error("cannot open");
    };
    await expect(reopenPage(call, 3, at, "auto", { alive: () => true, sync: () => calls.push(["sync", {}]) })).rejects.toThrow("cannot open");
    expect(calls).toEqual([]);
  });
});

describe("row 954c H6: a rebuild whose open failed ends on the closed overlay with Retry", () => {
  const url = "https://example.com/app";
  it("the machine goes to the closed phase, asks for the overlay, and Retry rebuilds", () => {
    const loading = step({ ...fresh(), phase: "ok", url }, { t: "selfclosed", reopen: true })[0];
    const [h, action] = step(loading, { t: "openfailed" });
    expect(action).toBe("overlay");
    expect(h.phase).toBe("closed");
    expect(overlayOf(h)).toEqual({ kind: "closed", url, openFailed: true });
    const [again, next] = step(h, { t: "retry" });
    expect(next).toBe("rebuild");
    expect(again.openFailed).toBe(false);
  });

  it("its words say the page could not be reopened, not that it closed itself", () => {
    const m = overlayModel({ kind: "closed", url, openFailed: true }, null, null);
    expect(m.title).toBe("This page could not be reopened");
    expect(m.text).toContain("Retry");
  });
});

describe("row 954c: BrowserPane wires the rebuild guards", () => {
  it("the pane tracks whether it is mounted, syncs bounds, and sends a failed open to the closed overlay", () => {
    expect(src).toContain("mountedFor.current === id");
    expect(src).toContain("sendBounds.current?.()");
    expect(src).toContain('feed({ t: "openfailed" })');
  });

  it("a tab left closed has its destroyed page closed, and Retry says retry", () => {
    expect(src).toContain('h.phase === "closed" && !h.openFailed) invoke("browser_close", { id })');
    expect(src).toContain('e.t === "retry" ? "retry" : "auto"');
  });
});

describe("after-list 719: BrowserPane uses the announcing open", () => {
  it("the pane's mount opens through openFirstPage (openPage inside), never a bare browser_open", () => {
    expect(src).toMatch(/await openFirstPage\(invoke, id,/);
    expect(src).not.toMatch(/invoke\("browser_open"/);
  });
});

describe("row 977: a restored pane's first open reads its own saved profile", () => {
  const first = { url: "https://example.com/", shown: true };
  const record = () => {
    const calls: [string, Record<string, unknown>][] = [];
    return { calls, call: (async (cmd, args) => void calls.push([cmd, args])) as Call };
  };

  it("the first browser_open of a restored pane carries rebuild restore", async () => {
    const { calls, call } = record();
    await openFirstPage(call, 5, first, true, { current: false });
    expect(calls[0]).toEqual(["browser_open", { id: 5, ...first, rebuild: "restore" }]);
    expect(calls[1]).toEqual(["browser_pane_ready", { id: 5 }]);
  });

  it("a pane that was not restored names no rebuild", async () => {
    const { calls, call } = record();
    await openFirstPage(call, 5, first, false, { current: false });
    expect("rebuild" in calls[0][1]).toBe(false);
  });

  it("the second open of a restored pane is not a restore", async () => {
    const { calls, call } = record();
    const spent = { current: false };
    await openFirstPage(call, 5, first, true, spent);
    calls.length = 0;
    await openFirstPage(call, 5, first, true, spent);
    expect("rebuild" in calls[0][1]).toBe(false);
  });

  it("a first open that fails leaves the restore for the next try", async () => {
    const spent = { current: false };
    await expect(openFirstPage(async () => { throw new Error("cannot open"); }, 5, first, true, spent)).rejects.toThrow("cannot open");
    const { calls, call } = record();
    await openFirstPage(call, 5, first, true, spent);
    expect(calls[0][1].rebuild).toBe("restore");
  });

  it("a reopen or Retry keeps naming its own reason, never restore", async () => {
    const { calls, call } = record();
    await reopenPage(call, 5, at, "retry");
    await reopenPage(call, 5, at);
    expect(calls.filter((c) => c[0] === "browser_open").map((c) => c[1].rebuild)).toEqual(["retry", "auto"]);
  });

  it("BrowserPane takes a restored prop that defaults to false and spends it once", () => {
    expect(src).toContain("restored?: boolean");
    expect(src).toContain("restored = false");
    expect(src).toContain("restored, restoreSpent)");
  });
});

describe("row 979 (F2): the address bar takes the keyboard only for a focused, not-restored pane", () => {
  const first = { url: "https://example.com/", shown: true };

  it("a restored pane's first open does not focus the bar", async () => {
    const restoring = await openFirstPage((async () => {}) as Call, 5, first, true, { current: false });
    expect(restoring).toBe(true);
    expect(takesBarFocus(true, restoring)).toBe(false);
    expect(takesBarFocus(false, restoring)).toBe(false);
  });

  it("a pane that is not the focused one does not focus the bar", async () => {
    const restoring = await openFirstPage((async () => {}) as Call, 5, first, false, { current: false });
    expect(restoring).toBe(false);
    expect(takesBarFocus(false, restoring)).toBe(false);
  });

  it("a focused fresh pane's first open does (BROW-001)", async () => {
    const restoring = await openFirstPage((async () => {}) as Call, 5, first, false, { current: false });
    expect(takesBarFocus(true, restoring)).toBe(true);
  });

  it("a restored pane's second open is not a restore, so a focused pane takes the bar", async () => {
    const spent = { current: false };
    await openFirstPage((async () => {}) as Call, 5, first, true, spent);
    expect(await openFirstPage((async () => {}) as Call, 5, first, true, spent)).toBe(false);
  });

  it("BrowserPane reads focused through a ref at the moment the open finishes", () => {
    expect(src).toContain("focusedNow.current = focused");
    expect(src).toContain("takesBarFocus(focusedNow.current, restoring)");
    expect(src).not.toMatch(/^\s*bar\.current\?\.focus\(\)/m); // never an unconditional focus
  });
});

// Row 954f: a page that closes itself twice got "a webview with label browser-N already exists" on its second
// rebuild and its loop cap was never reached. Cause: one destroy reached the pane twice (the dev build's
// first mount left its listeners behind), so two reopens ran at once and the losing open left a ghost engine record.
describe("row 954f: a pane never runs two reopens at once", () => {
  const settle = () => new Promise<void>((r) => setTimeout(r, 5));
  /** A back end whose browser_open takes a moment, recording how many opens overlap. */
  const slowOpens = () => {
    const log: string[] = [];
    const seen = { inFlight: 0, most: 0 };
    const call: Call = async (cmd, args) => {
      log.push(`${cmd}:${args.id}`);
      if (cmd !== "browser_open") return;
      seen.inFlight += 1;
      seen.most = Math.max(seen.most, seen.inFlight);
      await settle();
      seen.inFlight -= 1;
    };
    return { log, seen, call };
  };
  const opens = (log: string[], id: number) => log.filter((l) => l === `browser_open:${id}`).length;

  it("the same destroy heard twice (two automatic requests) rebuilds the page once", async () => {
    const { log, seen, call } = slowOpens();
    await Promise.all([reopenPage(call, 7, at), reopenPage(call, 7, at)]);
    expect(opens(log, 7)).toBe(1);
    expect(seen.most).toBe(1);
  });

  it("Retry pressed while a rebuild runs waits for it, then opens once more, never alongside", async () => {
    const { log, seen, call } = slowOpens();
    await Promise.all([reopenPage(call, 7, at), reopenPage(call, 7, at, "retry")]);
    expect(opens(log, 7)).toBe(2);
    expect(seen.most).toBe(1);
    expect(log.slice(0, 4)).toEqual(["browser_close:7", "browser_open:7", "browser_pane_ready:7", "browser_close:7"]);
  });

  it("a profile change while a rebuild runs also waits, and the latest of several waiting asks wins", async () => {
    const { seen, call } = slowOpens();
    const profiles: unknown[] = [];
    const watching: Call = async (cmd, args) => {
      if (cmd === "browser_open") profiles.push(args.profile);
      return call(cmd, args);
    };
    await Promise.all([reopenPage(watching, 7, at), reopenPage(watching, 7, { ...at, profile: "work" }), reopenPage(watching, 7, { ...at, profile: "alt" })]);
    expect(seen.most).toBe(1);
    expect(profiles).toEqual([undefined, "alt"]);
  });

  it("another pane's rebuild is not held up", async () => {
    const { log, seen, call } = slowOpens();
    await Promise.all([reopenPage(call, 7, at), reopenPage(call, 8, at)]);
    expect(opens(log, 7)).toBe(1);
    expect(opens(log, 8)).toBe(1);
    expect(seen.most).toBe(2);
  });

  it("a second destroy after the first rebuild ended rebuilds again (the cap lives in the back end)", async () => {
    const { log, call } = slowOpens();
    await reopenPage(call, 7, at);
    await reopenPage(call, 7, at);
    expect(opens(log, 7)).toBe(2);
  });

  it("a rebuild whose open failed does not block the next one", async () => {
    let fail = true;
    const log: string[] = [];
    const call: Call = async (cmd) => {
      log.push(cmd);
      if (cmd === "browser_open" && fail) throw new Error("boom");
    };
    await expect(reopenPage(call, 7, at)).rejects.toThrow("boom");
    fail = false;
    await reopenPage(call, 7, at, "retry");
    expect(log.filter((c) => c === "browser_open")).toHaveLength(2);
  });

  it("a page that unmounted before the queued ask ran is left alone", async () => {
    const { log, call } = slowOpens();
    let mounted = true;
    const live = { alive: () => mounted, sync: () => {} };
    const first = reopenPage(call, 7, at, "auto", live);
    const second = reopenPage(call, 7, at, "retry", live);
    mounted = false;
    await Promise.all([first, second]);
    expect(opens(log, 7)).toBe(0);
  });

  it("BrowserPane lets go of the listeners a cancelled mount registered while it was still starting", () => {
    expect(src).toMatch(/if \(!alive\) \{\s*unlisteners\.forEach\(\(u\) => u\(\)\);[^\n]*\s*return;\s*\}/);
  });
});
