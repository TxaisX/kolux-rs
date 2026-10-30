// T-620 (Txais 2026-10-30): the whole top bar moves the window, not one spot. Tauri's drag script
// (tauri 2.12, window/scripts/drag.js) starts a drag on a bare data-tauri-drag-region only when the
// press lands on that element itself, and the bar's three groups cover nearly all of it; "deep" drags
// from anywhere inside except controls, and "false" keeps the pop-up menus drawn inside the bar out of
// it, so a click on their backdrop still closes them instead of moving the window.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, click, find, installDom, mount, settle } from "../tasks/fakeDom";
import type { Group } from "../switcher/accounts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ isMaximized: () => Promise.resolve(false), onResized: () => Promise.resolve(() => {}) }) }));
vi.mock("../usage/UsagePill", () => ({ default: () => null }));

const DRAG = "data-tauri-drag-region";
let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  ({ doc } = installDom());
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

const menuParts = (c: FakeNode) => [find(c, (n) => n.attrs.class === "menu-backdrop")[0], find(c, (n) => n.attrs.role === "menu")[0]];

test("the whole bar drags the window, and its View menu does not", async () => {
  const { default: TopBar } = await import("./TopBar");
  const m = await mount(createElement(TopBar, { screen: "terminals", onScreen: () => {}, sidebarOpen: true, onToggleSidebar: () => {}, rightOpen: false, onToggleRight: () => {} }), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await settle();
  expect(find(c, (n) => n.localName === "header")[0].attrs[DRAG]).toBe("deep");
  const menu = find(c, (n) => n.localName === "button" && n.attrs.title === "Menu")[0];
  menu.getBoundingClientRect = () => ({ left: 8, bottom: 36 }); // the fake DOM has no layout
  await click(c, menu);
  await settle();
  for (const part of menuParts(c)) {
    expect(part, "the open View menu draws its backdrop and its list").toBeDefined();
    expect(part.attrs[DRAG]).toBe("false");
  }
});

test("the account switcher's menu inside the bar does not drag the window either", async () => {
  const { AccountSwitcherView } = await import("../switcher/AccountSwitcher");
  const groups: Group[] = [{ provider: "claude", name: "Claude", busy: false, note: null, choices: [{ id: null, label: "Default", active: true, trouble: null }] }];
  const m = await mount(createElement(AccountSwitcherView, { groups, open: { top: 40, left: 8 }, onOpen: () => {}, onClose: () => {}, onPick: () => {} }), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await settle();
  for (const part of menuParts(c)) {
    expect(part, "the open account menu draws its backdrop and its list").toBeDefined();
    expect(part.attrs[DRAG]).toBe("false");
  }
});
