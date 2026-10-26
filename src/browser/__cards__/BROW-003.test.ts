// BROW-003 acceptance on the real BrowserPane: text typed in the address bar and Enter, what the pane tells the engine to open.
// No page is fetched: the engine is a recorder, so "loads" is proven as the exact address handed to it (ONE READING, see ledger).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, fire, typeInto, until } from "../../tasks/fakeDom";
import { addressBar, installPaneDom, mountPane, notice, rec, sent } from "./paneHarness";

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
  await until(() => rec.calls.some((x) => x.cmd === "browser_open"));
  return c;
}
async function enter(c: FakeNode, text: string) {
  await typeInto(c, addressBar(c), text);
  await fire(c, "keydown", addressBar(c), { key: "Enter" });
}
const navigated = () => sent("browser_navigate").map((x) => x.args);

test("box 1: rust ownership + Enter -> a search on the standing engine (Google), words escaped", { timeout: 30000 }, async () => {
  const c = await pane();
  await enter(c, "rust ownership");
  expect(navigated()).toEqual([{ id: 7, url: "https://www.google.com/search?q=rust%20ownership" }]);
  expect(notice(c)).toBeNull();
});

test("box 2: example.com -> HTTPS; localhost:3000 -> plain HTTP", { timeout: 30000 }, async () => {
  const c = await pane();
  await enter(c, "example.com");
  await enter(c, "localhost:3000");
  expect(navigated()).toEqual([
    { id: 7, url: "https://example.com/" },
    { id: 7, url: "http://localhost:3000/" },
  ]);
});

test("box 3: a javascript: address -> invalid-address notice and no navigation (page unchanged)", { timeout: 30000 }, async () => {
  const c = await pane();
  await enter(c, "example.com");
  expect(navigated().length).toBe(1);
  for (const bad of ["javascript:alert(1)", "  JavaScript:alert(document.cookie)", "data:text/html,<b>x</b>"]) {
    await enter(c, bad);
    expect(notice(c)).toMatch(/^invalid address: \w+: is not a web or blank address$/);
  }
  expect(navigated()).toEqual([{ id: 7, url: "https://example.com/" }]); // still only the one real navigation
  expect(sent("browser_open").length).toBe(1);
  expect(sent("browser_close").length).toBe(0);
});
