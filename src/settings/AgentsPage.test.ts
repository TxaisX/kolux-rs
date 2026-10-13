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

test("the status hooks switch is off until saved on, says what off does and names the file (STAT-002, T-152-gate)", () => {
  expect(hooksOn({})).toBe(false);
  expect(hooksOn({ agentStatusHooks: "x" })).toBe(false);
  expect(hooksOn({ agentStatusHooks: false })).toBe(false);
  expect(hooksOn({ agentStatusHooks: true })).toBe(true);
  expect(renderToString(createElement(HooksSwitch, { on: false, onSwitch: () => {}, file: "G:/scratch/claude/settings.json" }))).toContain("G:/scratch/claude/settings.json");
  const html = renderToString(createElement(HooksSwitch, { on: true, onSwitch: () => {} }));
  expect(html).toContain('role="switch"');
  expect(html).toContain('checked=""');
  expect(html).toContain("stops them being put back");
  expect(renderToString(createElement(HooksSwitch, { on: false, onSwitch: () => {} }))).not.toContain('checked=""');
});
