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
