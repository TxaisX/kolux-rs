// The Automations page rendered to HTML with no browser: each empty state is its own, a failed
// load offers Retry and never says nothing was created, and the first automation is selected
// with its runs below.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import AutomationsPage, { type Data } from "./AutomationsPage";

const render = (initial: { data?: Data; error?: string }) =>
  renderToString(createElement(AutomationsPage, { projects: [{ id: "p1", name: "shop", path: "C:\\src\\shop" }], agents: [], settings: {}, onSettings: () => {}, initial }));

test("a failed load is an error with Retry, not a nothing-created message", () => {
  const html = render({ error: "the saved automations could not be read" });
  expect(html).toContain("Automations could not be loaded");
  expect(html).toContain("Retry");
  expect(html).not.toContain("No automations yet");
});

test("nothing created yet has its own empty state", () => {
  const html = render({ data: { automations: [], runs: [] } });
  expect(html).toContain("No automations yet");
  expect(html).not.toContain("Retry");
  expect(html).toContain("New Automation");
  expect(html).toContain("Runs");
});

test("opening the page selects the first automation in sort order and shows its numbered runs", () => {
  const data: Data = {
    automations: [
      { id: "auto-2", name: "Report 10", prompt: "weekly report", provider: "claude", projectId: "p1", enabled: true },
      { id: "auto-1", name: "Report 2", prompt: "nightly checks", provider: "claude", projectId: "p1", enabled: false },
    ],
    runs: [{ id: "run-1", automationId: "auto-1", number: 1, trigger: "manual", status: "dispatched", at: Date.now() }],
  };
  const html = render({ data });
  expect(html.indexOf("Report 2")).toBeLessThan(html.indexOf("Report 10"));
  expect(html).toMatch(/aria-selected="true"[^>]*>.*?Report 2/);
  expect(html).toContain("nightly checks");
  expect(html).toContain("#<!-- -->1");
  expect(html).toContain("by hand");
  expect(html).not.toContain('role="menu"'); // no row's menu is open
});
