import { describe, expect, it } from "vitest";
import { barItem, cardReducer, initialCard, mainAction, tipVisible, type Action, type CardState, type UpdateInfo } from "./card";

const info = (version: string, notes: string[] = ["One", "Two", "Three", "Four", "Five"]): UpdateInfo => ({ version, currentVersion: "0.1.0", notes });
const run = (s: CardState, ...actions: Action[]) => actions.reduce(cardReducer, s);

describe("update card (APP-026)", () => {
  it("a requested check on the newest version reports up to date, then fades away", () => {
    let s = run(initialCard(null, false), { type: "checkStart", requested: true });
    expect(s.shown).toBe(true);
    expect(s.phase.kind).toBe("checking");
    s = run(s, { type: "checkDone", requested: true, found: null });
    expect(s.phase.kind).toBe("upToDate");
    expect(mainAction(s.phase)).toBe("close");
    s = run(s, { type: "faded" });
    expect(s.shown).toBe(false);
  });

  it("background checks never bring up the card, not even when they fail", () => {
    let s = run(initialCard(null, false), { type: "checkStart", requested: false }, { type: "checkDone", requested: false, found: null });
    expect(s.shown).toBe(false);
    s = run(s, { type: "checkStart", requested: false }, { type: "checkFailed", requested: false, message: "x", offline: true });
    expect(s.shown).toBe(false);
    s = run(s, { type: "checkStart", requested: false }, { type: "checkDone", requested: false, found: info("0.2.0") });
    expect(s.shown).toBe(false);
    expect(s.phase.kind).toBe("available");
  });

  it("a requested check that fails shows the error with a next step", () => {
    const s = run(initialCard(null, false), { type: "checkStart", requested: true }, { type: "checkFailed", requested: true, message: "no answer", offline: true });
    expect(s.shown).toBe(true);
    expect(s.phase.kind === "error" && s.phase.next).toMatch(/offline/);
    expect(mainAction(s.phase)).toBe("retryCheck");
  });

  it("a download error brings up the card even after a quiet check", () => {
    const s = run(
      initialCard(null, false),
      { type: "checkDone", requested: false, found: info("0.2.0") },
      { type: "downloadStart", info: info("0.2.0") },
      { type: "downloadFailed", info: info("0.2.0"), message: "signature mismatch", offline: false },
    );
    expect(s.shown).toBe(true);
    expect(s.phase.kind).toBe("error");
    expect(mainAction(s.phase)).toBe("retryDownload");
  });

  it("walks available, downloading with progress, ready; the card waits for Restart", () => {
    let s = run(initialCard(null, true), { type: "checkStart", requested: true }, { type: "checkDone", requested: true, found: info("0.2.0") });
    expect(s.phase.kind).toBe("available");
    expect(mainAction(s.phase)).toBe("download");
    s = run(s, { type: "downloadStart", info: info("0.2.0") }, { type: "progress", version: "0.2.0", received: 50, total: 100 });
    expect(s.phase.kind === "downloading" && s.phase.received / (s.phase.total ?? 1)).toBe(0.5);
    s = run(s, { type: "ready", info: info("0.2.0") });
    expect(s.phase.kind).toBe("ready");
    expect(mainAction(s.phase)).toBe("restart");
  });

  it("collapsing hides the body and every change of phase reopens it", () => {
    let s = run(initialCard(null, true), { type: "checkStart", requested: true }, { type: "checkDone", requested: true, found: info("0.2.0") }, { type: "collapse" });
    expect(s.collapsed).toBe(true);
    s = run(s, { type: "downloadStart", info: info("0.2.0") });
    expect(s.collapsed).toBe(false);
    s = run(s, { type: "collapse" }, { type: "ready", info: info("0.2.0") });
    expect(s.collapsed).toBe(false);
  });

  it("a dismissed version stays away; a newer one comes back", () => {
    let s = run(initialCard(null, true), { type: "checkStart", requested: true }, { type: "checkDone", requested: true, found: info("0.2.0") }, { type: "dismiss" });
    expect(s.shown).toBe(false);
    expect(s.dismissed).toBe("0.2.0");
    s = run(s, { type: "downloadStart", info: info("0.2.0") }, { type: "progress", version: "0.2.0", received: 1, total: 2 });
    expect(s.shown).toBe(false);
    s = run(s, { type: "checkDone", requested: false, found: info("0.2.0") });
    expect(s.shown).toBe(false);
    s = run(s, { type: "checkStart", requested: true }, { type: "checkDone", requested: true, found: info("0.3.0") });
    expect(s.shown).toBe(true);
    expect(s.phase.kind === "available" && s.phase.info.version).toBe("0.3.0");
  });

  it("the reassurance tip shows the first time only and is gone once dismissed or a download starts", () => {
    let s = run(initialCard(null, false), { type: "checkStart", requested: true }, { type: "checkDone", requested: true, found: info("0.2.0") });
    expect(tipVisible(s)).toBe(true);
    s = run(s, { type: "downloadStart", info: info("0.2.0") });
    expect(s.tipDone).toBe(true);
    s = run(s, { type: "checkStart", requested: true }, { type: "checkDone", requested: true, found: info("0.3.0") });
    expect(tipVisible(s)).toBe(false);
    let t = run(initialCard(null, false), { type: "checkStart", requested: true }, { type: "checkDone", requested: true, found: info("0.2.0") }, { type: "tipDismiss" });
    expect(tipVisible(t)).toBe(false);
    expect(t.tipDone).toBe(true);
    t = run(t, { type: "checkStart", requested: true }, { type: "checkDone", requested: true, found: info("0.2.0") });
    expect(tipVisible(t)).toBe(false);
  });
});

describe("error wording", () => {
  it("turns the updater's words into a plain sentence", async () => {
    const { plainError } = await import("./card");
    expect(plainError("error sending request for url (http://127.0.0.1:18790/latest.json)")).toBe("Kolux RS could not reach the update server.");
    expect(plainError("The update check got no answer within 45 seconds.")).toBe("Kolux RS could not reach the update server.");
    expect(plainError("signature verification failed")).toMatch(/signature did not match/);
    expect(plainError("something odd")).toBe("something odd");
  });
});

describe("release notes (APP-027)", () => {
  it("stay through available, downloading, ready and error, and clear when a new check begins", () => {
    let s = run(initialCard(null, true), { type: "checkStart", requested: true }, { type: "checkDone", requested: true, found: info("0.2.0") });
    expect(s.notes).toHaveLength(5);
    s = run(s, { type: "downloadStart", info: info("0.2.0") });
    expect(s.notes).toHaveLength(5);
    s = run(s, { type: "downloadFailed", info: info("0.2.0"), message: "x", offline: false });
    expect(s.notes).toHaveLength(5);
    s = run(s, { type: "checkStart", requested: true });
    expect(s.notes).toEqual([]);
  });

  it("an update without notes still goes through", () => {
    const s = run(initialCard(null, true), { type: "checkDone", requested: true, found: info("0.2.0", []) }, { type: "downloadStart", info: info("0.2.0", []) }, { type: "ready", info: info("0.2.0", []) });
    expect(s.phase.kind).toBe("ready");
    expect(s.notes).toEqual([]);
  });
});

describe("ready pop-up (APP-025)", () => {
  const quietReady = (s: CardState, v: string) =>
    run(s, { type: "checkDone", requested: false, found: info(v) }, { type: "downloadStart", info: info(v) }, { type: "ready", info: info(v) });

  it("appears once per version per launch; closed, it does not come back", () => {
    let s = quietReady(initialCard(null, true), "0.2.0");
    expect(s.popup).toBe("0.2.0");
    expect(s.shown).toBe(false);
    s = run(s, { type: "popupClose" });
    expect(s.popup).toBeNull();
    s = run(s, { type: "ready", info: info("0.2.0") });
    expect(s.popup).toBeNull();
    // A newer version gets its own pop-up.
    s = quietReady(s, "0.3.0");
    expect(s.popup).toBe("0.3.0");
  });

  it("stays silent while the update card shows that same update", () => {
    const s = run(
      initialCard(null, true),
      { type: "checkStart", requested: true },
      { type: "checkDone", requested: true, found: info("0.2.0") },
      { type: "downloadStart", info: info("0.2.0") },
      { type: "ready", info: info("0.2.0") },
    );
    expect(s.shown).toBe(true);
    expect(s.popup).toBeNull();
  });

  it("goes away when the update stops being ready", () => {
    let s = quietReady(initialCard(null, true), "0.2.0");
    s = run(s, { type: "notReady" });
    expect(s.popup).toBeNull();
  });
});

describe("status bar item (VIEW-100)", () => {
  it("shows nothing while idle, checking or up to date", () => {
    expect(barItem({ kind: "idle" })).toBeNull();
    expect(barItem({ kind: "checking" })).toBeNull();
    expect(barItem({ kind: "upToDate" })).toBeNull();
  });

  it("names an available, downloading, ready or failed update", () => {
    expect(barItem({ kind: "available", info: info("0.2.0") })).toMatchObject({ tone: "info", text: "Update 0.2.0" });
    expect(barItem({ kind: "downloading", info: info("0.2.0"), received: 25, total: 100 })).toMatchObject({ tone: "info", text: "Downloading 0.2.0 · 25%" });
    expect(barItem({ kind: "downloading", info: info("0.2.0"), received: 25, total: null })).toMatchObject({ text: "Downloading 0.2.0" });
    expect(barItem({ kind: "ready", info: info("0.2.0") })).toMatchObject({ tone: "ready", text: "Restart to update" });
    const failed = barItem({ kind: "error", message: "m", next: "n", info: info("0.2.0"), retry: "download" });
    expect(failed).toMatchObject({ tone: "error", text: "Update failed" });
  });

  it("a click brings back a dismissed or collapsed card, and the failure item stays until then", () => {
    let s = run(initialCard(null, true), { type: "checkStart", requested: false }, { type: "checkDone", requested: false, found: info("0.2.0") }, { type: "downloadStart", info: info("0.2.0") });
    s = run(s, { type: "downloadFailed", info: info("0.2.0"), message: "signature", offline: false }, { type: "collapse" });
    expect(barItem(s.phase)?.tone).toBe("error");
    s = run(s, { type: "show" });
    expect(s.shown && !s.collapsed).toBe(true);
    s = run(initialCard(null, true), { type: "ready", info: info("0.2.0") }, { type: "dismiss" }, { type: "show" });
    expect(s.shown).toBe(true);
    expect(run(initialCard(null, true), { type: "show" }).shown).toBe(false);
  });
});
