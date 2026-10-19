import { expect, test } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import StatusBar from "./StatusBar";
import { readStatusBar, STATUS_ITEMS, toggleItem } from "./statusItems";

test("VIEW-096: everything shows until something is hidden", () => {
  expect(readStatusBar({})).toEqual({ visible: true, hidden: [] });
  expect(readStatusBar({ statusBarVisible: false }).visible).toBe(false);
  expect(STATUS_ITEMS.map((i) => i.id)).toEqual(["hooks", "memory", "terminals", "agents", "ports", "awake"]);
});

test("VIEW-096: an old saved list keeps the items it knows and drops retired or unknown ones", () => {
  expect(readStatusBar({ statusBarHidden: ["memory", "usage-claude", 7, "memory", "agents"] }).hidden).toEqual(["memory", "agents"]);
  expect(readStatusBar({ statusBarHidden: "memory" }).hidden, "not a list: nothing hidden").toEqual([]);
});

test("VIEW-096: unticking an item hides it, ticking it again brings it back", () => {
  const off = toggleItem([], "memory");
  expect(off).toEqual(["memory"]);
  expect(toggleItem(off, "memory")).toEqual([]);
});

test("VIEW-096: a hidden item is not drawn, the others are", () => {
  const html = renderToString(createElement(StatusBar, { terminals: 3, agents: 1, hidden: ["memory"] }));
  expect(html).not.toContain("res-open");
  expect(html).toContain("Terminals running");
  const all = renderToString(createElement(StatusBar, { terminals: 3 }));
  expect(all).toContain("res-open");
});

test("VIEW-078: the ports item can be unticked like the others", () => {
  const all = renderToString(createElement(StatusBar, { terminals: 1 }));
  expect(all).toContain("ports-item");
  const off = renderToString(createElement(StatusBar, { terminals: 1, hidden: ["ports"] }));
  expect(off).not.toContain("ports-item");
  expect(readStatusBar({ statusBarHidden: ["ports"] }).hidden).toEqual(["ports"]);
});
