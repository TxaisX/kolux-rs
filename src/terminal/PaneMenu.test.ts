// TERM-025 / TERM-013: the pane menu rendered to HTML: its items, their shortcuts, and expand
// switched off for a lone classic pane.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import PaneMenu from "./PaneMenu";

const render = (expanded: boolean, canExpand: boolean) => renderToString(createElement(PaneMenu, { style: {}, expanded, canExpand, onExpand: () => {}, onSplit: () => {}, onClose: () => {}, onDismiss: () => {} }));
const itemOf = (html: string, name: string) => html.split("<button").find((b) => b.includes(name))!;

test("TERM-025: the pane menu offers expand, split right, split down and close, with their shortcuts", () => {
  const html = render(false, true);
  const names = [...html.matchAll(/class="name">([^<]+)</g)].map((m) => m[1]);
  expect(names).toEqual(["Expand pane", "Split right", "Split down", "Close pane"]);
  expect(itemOf(html, "Expand pane")).toContain("Ctrl+Shift+Enter");
  expect(itemOf(html, "Close pane")).toContain("Ctrl+W");
  expect(itemOf(html, "Expand pane")).not.toContain("disabled");
});

test("TERM-013: an expanded pane's menu offers Restore; a lone classic pane cannot expand", () => {
  expect(render(true, true)).toContain("Restore pane");
  expect(itemOf(render(false, false), "Expand pane")).toContain("disabled");
});
