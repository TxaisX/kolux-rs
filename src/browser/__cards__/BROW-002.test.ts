// BROW-002 (pane half only; both boxes stay LIVE): away means covered, never torn down. The real BrowserPane is hidden and
// shown again; the page (a child web view in the engine) must only be hidden and moved, never closed or opened a second time.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, until, settle } from "../../tasks/fakeDom";
import { installPaneDom, last, rec, sent } from "./paneHarness";

vi.mock("@tauri-apps/api/core", async () => (await import("./paneHarness")).coreMock);
vi.mock("@tauri-apps/api/event", async () => (await import("./paneHarness")).eventMock);
vi.mock("@tauri-apps/api/webview", async () => (await import("./paneHarness")).webviewMock);
vi.mock("@tauri-apps/plugin-dialog", async () => (await import("./paneHarness")).dialogMock);

let doc: FakeDocument;
beforeEach(() => {
  doc = installPaneDom();
});
afterEach(() => {
  vi.restoreAllMocks();
});

test("hiding the tab hides the page and showing it moves it back; nothing is closed or opened again", { timeout: 30000 }, async () => {
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: BrowserPane } = await import("../BrowserPane");
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  const render = (hidden: boolean) => act(async () => root.render(createElement(BrowserPane, { id: 7, hidden })));
  await render(false);
  await until(() => sent("browser_open").length === 1 && sent("browser_bounds").length > 0);
  expect(last(sent("browser_bounds"))?.args).toMatchObject({ id: 7, shown: true });
  await render(true); // to a terminal tab / another worktree
  await until(() => last(sent("browser_bounds"))?.args.shown === false);
  expect(last(sent("browser_bounds"))?.args.spot).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  await settle();
  await render(false); // back
  await until(() => last(sent("browser_bounds"))?.args.shown === true);
  expect(sent("browser_open").length).toBe(1);
  expect(sent("browser_close").length).toBe(0);
  expect(rec.calls.some((c) => c.cmd === "browser_navigate" || (c.cmd === "browser_go" && c.args.what === "reload"))).toBe(false);
  await act(async () => root.unmount());
});
