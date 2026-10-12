import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { AgentsPageView } from "./AgentsPage";

test("the Agents page carries the 200k cap switch, on by default (USAGE-006)", () => {
  const html = renderToString(createElement(AgentsPageView, { cap: true, onCap: () => {} }));
  expect(html).toContain('role="switch"');
  expect(html).toContain('checked=""');
  expect(html).toContain("200k");
  expect(renderToString(createElement(AgentsPageView, { cap: false, onCap: () => {} }))).not.toContain('checked=""');
});
