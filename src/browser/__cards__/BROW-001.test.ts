// BROW-001 (parts only; box 1 and box 2 stay LIVE): the New Tab chord, and the pane taking the keyboard into its address bar.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { actions, type Scope } from "../../keys/actions";
import { defaultsOnly, matchEvent, type KeyLike } from "../../keys/keymap";
import { type FakeDocument, type FakeNode, until } from "../../tasks/fakeDom";
import { addressBar, installPaneDom, last, mountPane, rec } from "./paneHarness";

vi.mock("@tauri-apps/api/core", async () => (await import("./paneHarness")).coreMock);
vi.mock("@tauri-apps/api/event", async () => (await import("./paneHarness")).eventMock);
vi.mock("@tauri-apps/api/webview", async () => (await import("./paneHarness")).webviewMock);
vi.mock("@tauri-apps/plugin-dialog", async () => (await import("./paneHarness")).dialogMock);

const key = (k: Partial<KeyLike>): KeyLike => ({ key: "B", code: "KeyB", ctrlKey: false, altKey: false, shiftKey: true, metaKey: false, ...k });
const everywhere = [...new Set(actions.map((a) => a.scope))] as Scope[];

test("Mod+Shift+B is the New browser tab command on every platform (Ctrl on Windows and Linux, Cmd on Mac)", () => {
  expect(matchEvent(defaultsOnly("win32"), key({ ctrlKey: true }), everywhere)).toEqual({ id: "tab.newBrowser" });
  expect(matchEvent(defaultsOnly("linux"), key({ ctrlKey: true }), everywhere)).toEqual({ id: "tab.newBrowser" });
  expect(matchEvent(defaultsOnly("darwin"), key({ metaKey: true }), everywhere)).toEqual({ id: "tab.newBrowser" });
});

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  doc = installPaneDom();
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

test("a new browser pane is titled New Tab and hands the keyboard to its address bar once the page exists", { timeout: 30000 }, async () => {
  const focused: FakeNode[] = [];
  const proto = (doc.createElement("div") as FakeNode).constructor.prototype as Record<string, unknown>;
  proto.focus = function (this: FakeNode) {
    focused.push(this);
  };
  const m = await mountPane(doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await until(() => rec.calls.some((x) => x.cmd === "browser_open"));
  await until(() => focused.length > 0 && last(focused) === addressBar(c));
  expect(c.textContent).toContain("New Tab");
});
