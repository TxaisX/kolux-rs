// BROW-008 and BROW-009 on the real BrowserPane. The engine is a recorder plus a script: what the pane's probe
// (browser_probe) hears, what browser_diagnose says, and the browser-load events the test raises. Whether the real
// engine's error page and a dead renderer look like these answers is not claimed here (LIVE in the ledger).
import { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { click, type FakeDocument, type FakeNode, find, fire, typeInto } from "../../tasks/fakeDom";
import { addressBar, button, engineLoad, installPaneDom, last, mountPane, rec, sent } from "./paneHarness";

const script = vi.hoisted(() => ({ probe: "page" as string, diag: null as unknown, handler: true as boolean | null }));
vi.mock("@tauri-apps/api/core", async () => {
  const h = await import("./paneHarness");
  return {
    invoke: (cmd: string, args: Record<string, unknown> = {}) => {
      h.rec.calls.push({ cmd, args });
      if (cmd === "browser_probe") return Promise.resolve(script.probe);
      if (cmd === "browser_diagnose") return Promise.resolve(script.diag);
      if (cmd === "browser_external_handler") return Promise.resolve(script.handler);
      return Promise.resolve(cmd === "browser_suggest" ? [] : null);
    },
  };
});
vi.mock("@tauri-apps/api/event", async () => (await import("./paneHarness")).eventMock);
vi.mock("@tauri-apps/api/webview", async () => (await import("./paneHarness")).webviewMock);
vi.mock("@tauri-apps/plugin-dialog", async () => (await import("./paneHarness")).dialogMock);

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  doc = installPaneDom();
  Object.assign(script, { probe: "page", diag: null, handler: true });
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function pause(ms: number) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
async function waitFor(ok: () => boolean, what: string, ms = 6000) {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`gave up waiting for ${what}`);
    await pause(10);
  }
}
async function pane() {
  const m = await mountPane(doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await waitFor(() => rec.handlers.has("browser-load") && rec.calls.some((x) => x.cmd === "browser_open"), "the page to open");
  return c;
}
const overlayOf = (c: FakeNode): FakeNode | undefined => find(c, (n) => n.attrs.role === "alert" && n.attrs["data-kind"] !== undefined)[0];
const goButtons = (c: FakeNode, go: string) => find(c, (n) => n.localName === "button" && n.attrs["data-go"] === go);
const reloads = () => sent("browser_go").filter((x) => x.args.what === "reload");
const disabled = (n: FakeNode) => n.disabled === true || n.attrs.disabled !== undefined;

async function typeAddress(c: FakeNode, text: string) {
  await typeInto(c, addressBar(c), text);
  await fire(c, "keydown", addressBar(c), { key: "Enter" });
}

// ---------------------------------------------------------------- BROW-008

test("BROW-008 box 1 (pane half): a refused local address gets the overlay with local-server advice and Retry; Retry brings the page back", { timeout: 30000 }, async () => {
  const c = await pane();
  await typeAddress(c, "localhost:9");
  expect(last(sent("browser_navigate"))?.args).toEqual({ id: 7, url: "http://localhost:9/" });
  script.probe = "error-page";
  script.diag = { kind: "refused", local: true, https: null };
  await engineLoad("started", "http://localhost:9/");
  await engineLoad("finished", "http://localhost:9/");
  await waitFor(() => overlayOf(c) !== undefined && /Nothing is listening/.test(overlayOf(c)!.textContent), "the failed overlay");
  const o = overlayOf(c)!;
  expect(o.attrs["data-kind"]).toBe("failed");
  expect(o.textContent).toContain("This page could not load");
  expect(o.textContent).toContain("Nothing is listening on localhost:9.");
  expect(o.textContent).toContain("If this is your own server, start it, then press Retry.");
  expect(goButtons(c, "retry").length).toBe(1);
  expect(goButtons(c, "https").length).toBe(0); // a local address is never offered the https switch
  // The page itself is hidden under the overlay (a native child view cannot be covered).
  expect(last(sent("browser_bounds"))?.args.shown).toBe(false);
  // Probing is paused while the overlay is up.
  const probes = sent("browser_probe").length;
  await pause(600);
  expect(sent("browser_probe").length).toBe(probes);

  // "start a server and press Retry": the retry is a reload, the buttons grey out, the page loads, the overlay goes.
  script.probe = "page";
  const before = reloads().length;
  await click(c, goButtons(c, "retry")[0]);
  expect(reloads().length).toBe(before + 1);
  expect(disabled(goButtons(c, "retry")[0])).toBe(true);
  await engineLoad("started", "http://localhost:9/");
  await engineLoad("finished", "http://localhost:9/");
  await waitFor(() => overlayOf(c) === undefined, "the overlay to go");
  expect(last(sent("browser_bounds"))?.args.shown).toBe(true);
  await pause(600);
  expect(overlayOf(c)).toBeUndefined(); // the probe hears a page and nothing comes back
});

test("BROW-008 box 2 (pane half): a certificate failure on a public address gets the certificate wording and no local-server advice", { timeout: 30000 }, async () => {
  const c = await pane();
  await typeAddress(c, "https://expired.example.invalid/");
  script.probe = "error-page";
  script.diag = { kind: "certificate", local: false, https: null };
  await engineLoad("started", "https://expired.example.invalid/");
  await engineLoad("finished", "https://expired.example.invalid/");
  await waitFor(() => overlayOf(c) !== undefined && /certificate/.test(overlayOf(c)!.textContent), "the certificate overlay");
  const text = overlayOf(c)!.textContent;
  expect(text).toContain("expired.example.invalid showed a certificate Kolux does not trust");
  expect(text).toContain("Certificate checking stays strict.");
  expect(text).not.toMatch(/your own server|start it|Nothing is listening/);
  expect(find(c, (n) => n.localName === "p" && /advice/.test(String(n.attrs.class ?? n.attrs.className ?? ""))).length).toBe(0);
  expect(goButtons(c, "retry").length).toBe(1);
});

// ---------------------------------------------------------------- BROW-009

/** A page that loaded and answers its probes. */
async function openLivePage(c: FakeNode, url: string) {
  await typeAddress(c, url);
  await engineLoad("started", url);
  await engineLoad("finished", url);
  script.probe = "page";
  await pause(600); // two probes hear the page
}

test("BROW-009 box 1 (pane half): a page that stops answering is reloaded in place with no overlay and nothing asked of the user", { timeout: 30000 }, async () => {
  const c = await pane();
  await openLivePage(c, "https://a.test/");
  expect(reloads().length).toBe(0);
  script.probe = "no-answer";
  await waitFor(() => reloads().length === 1, "the automatic reload", 8000);
  expect(overlayOf(c)).toBeUndefined();
  expect(sent("browser_close").length).toBe(0); // reloaded in place, not rebuilt
  // The reload comes back: the page is the page again, nothing else happens.
  script.probe = "page";
  await engineLoad("started", "https://a.test/");
  await engineLoad("finished", "https://a.test/");
  await pause(900);
  expect(overlayOf(c)).toBeUndefined();
  expect(reloads().length).toBe(1);
});

test("BROW-009 box 2: recovery that fails leaves an error on screen; Retry from the toolbar rebuilds the page and it is back", { timeout: 30000 }, async () => {
  const c = await pane();
  await openLivePage(c, "https://a.test/");
  const opens = sent("browser_open").length;
  // Force recovery to fail: the page dies and the one automatic reload does not bring it back either.
  script.probe = "no-answer";
  await waitFor(() => reloads().length === 1, "the automatic reload", 8000);
  await engineLoad("started", "https://a.test/");
  await engineLoad("finished", "https://a.test/");
  await waitFor(() => overlayOf(c) !== undefined, "the crashed overlay", 8000);
  const o = overlayOf(c)!;
  expect(o.attrs["data-kind"]).toBe("crashed");
  expect(o.textContent).toContain("This page stopped responding");
  expect(o.textContent).toContain("Kolux reloaded it once and it did not come back.");
  expect(o.textContent).not.toMatch(/your own server|Nothing is listening|certificate/); // no network troubleshooting text
  // The error stays: no second automatic reload, no loop.
  await pause(900);
  expect(reloads().length).toBe(1);
  expect(overlayOf(c)).toBeDefined();
  // "retry from the toolbar": the toolbar's reload button is the Retry while the overlay is up.
  script.probe = "page";
  await click(c, button(c, "reload"));
  await waitFor(() => sent("browser_open").length === opens + 1, "the page to be rebuilt");
  const order = rec.calls.map((x) => x.cmd).filter((x) => x === "browser_close" || x === "browser_open");
  expect(order.slice(-2)).toEqual(["browser_close", "browser_open"]); // closed, then opened again
  expect(last(sent("browser_open"))?.args.url).toBe("https://a.test/"); // back on its page
  expect(reloads().length).toBe(1); // a rebuild, not another reload of the dead page
  await engineLoad("started", "https://a.test/");
  await engineLoad("finished", "https://a.test/");
  await waitFor(() => overlayOf(c) === undefined, "the overlay to go");
  await pause(900);
  expect(overlayOf(c)).toBeUndefined();
});
