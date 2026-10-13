import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { AgentsPageView, HooksSwitch, hooksOn } from "./AgentsPage";

test("the Agents page carries the 200k cap switch, on by default (USAGE-006)", () => {
  const html = renderToString(createElement(AgentsPageView, { cap: true, onCap: () => {} }));
  expect(html).toContain('role="switch"');
  expect(html).toContain('checked=""');
  expect(html).toContain("200k");
  expect(renderToString(createElement(AgentsPageView, { cap: false, onCap: () => {} }))).not.toContain('checked=""');
});

test("the status hooks switch is on unless saved off, and says what off does (STAT-002)", () => {
  expect(hooksOn({})).toBe(true);
  expect(hooksOn({ agentStatusHooks: "x" })).toBe(true);
  expect(hooksOn({ agentStatusHooks: false })).toBe(false);
  const html = renderToString(createElement(HooksSwitch, { on: true, onSwitch: () => {} }));
  expect(html).toContain('role="switch"');
  expect(html).toContain('checked=""');
  expect(html).toContain("stops them being put back");
  expect(renderToString(createElement(HooksSwitch, { on: false, onSwitch: () => {} }))).not.toContain('checked=""');
});
