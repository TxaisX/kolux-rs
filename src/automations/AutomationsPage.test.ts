// The Automations page rendered to HTML with no browser: each empty state is its own, a failed
// load offers Retry and never says nothing was created, and the first automation is selected
// with its runs below.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import AutomationsPage, { type Data } from "./AutomationsPage";

const render = (initial: { data?: Data; error?: string; runs?: boolean }) =>
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

const many: Data = {
  automations: [
    { id: "auto-1", name: "Nightly checks", prompt: "", provider: "claude", projectId: "p1", enabled: true },
    { id: "auto-2", name: "On new PR", prompt: "", provider: "claude", projectId: "p1", enabled: true, trigger: { kind: "event", event: "pr-opened" } },
  ],
  runs: [
    { id: "run-1", automationId: "auto-1", number: 1, trigger: "manual", status: "failed", at: Date.now() - 60000, detail: "claude did not start" },
    { id: "run-2", automationId: "auto-2", number: 1, trigger: "event", status: "completed", at: Date.now() - 120000 },
  ],
};

test("AUTO-015: Runs opens one table of every automation's runs, with tiles and the event named on hover", () => {
  const html = render({ data: many, runs: true });
  expect(html).toContain("Nightly checks");
  expect(html).toContain("On new PR");
  expect(html).toContain('title="When a pull request opens"');
  expect(html).toMatch(/<b>1<\/b> succeeded in 24 h/);
  expect(html).toMatch(/<b>1<\/b> failed in 7 days/);
  expect(html).toContain("Automations</button>");
  expect(html).not.toContain("New Automation");
});

test("AUTO-015: with no runs at all the dashboard says so plainly", () => {
  const html = render({ data: { automations: many.automations, runs: [] }, runs: true });
  expect(html).toContain("No runs yet");
});

test("AUTO-015: the Runs button is live on the Automations page", () => {
  const html = render({ data: many });
  expect(html).toMatch(/<button class="btn" title="Every automation&#x27;s runs in one place">Runs<\/button>/);
});
