import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readAppearance } from "../theme";
import { AppearanceView } from "./AppearancePage";

test("SET-016: Interface, Terminal and Window & Sidebar, all open at first; fonts sit in Interface", () => {
  const html = renderToString(createElement(AppearanceView, { look: readAppearance({}), onChange: () => {}, windowPart: createElement("p", null, "status switch"), windowSummary: "Status bar shown" }));
  const folds = [...html.matchAll(/<details class="look-fold" data-fold="(\w+)" open="">/g)].map((m) => m[1]);
  expect(folds).toEqual(["interface", "terminal", "window"]);
  expect(html).toContain("Window &amp; Sidebar");
  expect(html).toContain("status switch");
  expect(html.indexOf("App font")).toBeLessThan(html.indexOf('data-fold="terminal"'));
  expect(html).toContain("Editor font");
});

test("SET-023: the Panes card in Terminal holds divider width, a colour per mode and the dim", () => {
  const html = renderToString(createElement(AppearanceView, { look: readAppearance({ paneDividerDark: "#aa3300", paneDim: 70 }), onChange: () => {} }));
  const panes = html.slice(html.indexOf('data-section="panes"'), html.indexOf('data-fold="window"'));
  expect(panes).toContain("Divider width");
  expect(panes).toContain('aria-label="Divider colour, dark mode" value="#aa3300"');
  expect(panes).toContain("Divider colour, light mode");
  expect(panes.match(/>Clear</g)?.length, "only the set colour can be cleared").toBe(1);
  expect(panes).toMatch(/Panes not in focus.*value="70"/);
});
