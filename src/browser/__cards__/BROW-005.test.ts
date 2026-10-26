// BROW-005 acceptance on the real BrowserPane; the engine is stood in by a recorder of the commands the pane sends
// and of the browser-load events it would raise. Whether the engine really halts a load is not claimed here.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { click, type FakeDocument, type FakeNode, until } from "../../tasks/fakeDom";
import { button, engineLoad, installPaneDom, isDisabled, last, mountPane, rec, sent } from "./paneHarness";

vi.mock("@tauri-apps/api/core", async () => (await import("./paneHarness")).coreMock);
vi.mock("@tauri-apps/api/event", async () => (await import("./paneHarness")).eventMock);
vi.mock("@tauri-apps/api/webview", async () => (await import("./paneHarness")).webviewMock);
vi.mock("@tauri-apps/plugin-dialog", async () => (await import("./paneHarness")).dialogMock);

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  doc = installPaneDom();
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function pane() {
  const m = await mountPane(doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await until(() => rec.handlers.has("browser-load") && rec.calls.some((x) => x.cmd === "browser_open"));
  return c;
}
const A = "https://a.test/";
const B = "https://b.test/";

test("box 2: a fresh tab has back and forward both disabled, also once its blank page has loaded", { timeout: 30000 }, async () => {
  const c = await pane();
  expect(isDisabled(button(c, "back"))).toBe(true);
  expect(isDisabled(button(c, "forward"))).toBe(true);
  await engineLoad("started", "about:blank");
  await engineLoad("finished", "about:blank");
  expect(isDisabled(button(c, "back"))).toBe(true);
  expect(isDisabled(button(c, "forward"))).toBe(true);
});

test("box 2 (control): the same buttons do come alive after pages, so the disabled state above is real", { timeout: 30000 }, async () => {
  const c = await pane();
  await engineLoad("started", A);
  await engineLoad("finished", A);
  await engineLoad("started", B);
  await engineLoad("finished", B);
  expect(isDisabled(button(c, "back"))).toBe(false);
  expect(isDisabled(button(c, "forward"))).toBe(true);
  await click(c, button(c, "back"));
  expect(last(sent("browser_go"))?.args).toEqual({ id: 7, what: "back" });
  await engineLoad("started", A);
  await engineLoad("finished", A);
  expect(isDisabled(button(c, "back"))).toBe(false); // the blank page is behind A
  expect(isDisabled(button(c, "forward"))).toBe(false);
});

test("box 1 (pane half): while a page loads the button is Stop, pressing it asks the engine to stop, after the load it reads Reload", { timeout: 30000 }, async () => {
  const c = await pane();
  expect(button(c, "reload")).toBeTruthy();
  await engineLoad("started", A);
  expect(button(c, "stop")).toBeTruthy();
  expect(String(button(c, "stop").attrs.className ?? button(c, "stop").attrs.class ?? "")).toMatch(/loading/);
  expect(button(c, "reload")).toBeUndefined();
  await click(c, button(c, "stop"));
  expect(last(sent("browser_go"))?.args).toEqual({ id: 7, what: "stop" });
  await engineLoad("finished", A);
  expect(button(c, "stop")).toBeUndefined();
  expect(button(c, "reload")).toBeTruthy();
});
