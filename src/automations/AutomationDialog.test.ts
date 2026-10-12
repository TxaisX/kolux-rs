// The automation dialog rendered to HTML with no browser: a new one opens on the weekday preset with
// the keep-going note, and Save stays off until the project's worktrees are read (AUTO-005).
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import AutomationDialog from "./AutomationDialog";
import type { Automation } from "./model";
import { templates } from "./timetable";

const projects = [{ id: "p1", name: "shop", path: "C:\\src\\shop", base: "main" }];
const render = (editing: Automation | null) => renderToString(createElement(AutomationDialog, { projects, agents: [], editing, onClose: () => {}, onSaved: () => {} }));

test("a new automation opens on Monday to Friday with Save held until the worktrees are read", () => {
  const html = render(null);
  expect(html).toContain("New Automation");
  expect(html).toContain("keeps running on this timetable until you pause it");
  expect(html).toMatch(/<option value="weekdays" selected="">Monday to Friday/);
  expect(html).toMatch(/<button class="btn primary" disabled=""[^>]*>Save/);
  expect(html).toContain('aria-modal="true"');
});

test("editing opens with the saved copy: its name, prompt, base and custom line", () => {
  const html = render({
    id: "auto-1",
    name: "Leap",
    prompt: "check the calendar",
    provider: "codex",
    projectId: "p1",
    enabled: true,
    workspaceMode: "new-per-run",
    baseBranch: "release",
    trigger: { kind: "schedule", cron: "0 0 29 2 *", timezone: "UTC" },
    form: { preset: "custom", time: "", day: null, custom: "0 0 29 2 *" },
  });
  expect(html).toContain("Edit automation");
  expect(html).toContain('value="Leap"');
  expect(html).toContain("check the calendar");
  expect(html).toContain('value="release"');
  expect(html).toContain('value="0 0 29 2 *"');
  expect(html).toContain('value="UTC"');
});

test("the clock time is an hour box, a minute box and AM or PM; hourly keeps only the minutes (AUTO-003)", () => {
  const html = render(null);
  expect(html).toContain('aria-label="Hour"');
  expect(html).toContain('aria-label="Minute"');
  expect(html).toMatch(/<option value="AM" selected="">AM/);
  expect(html).toContain('value="9"');
  const hourly = render({ id: "a", name: "u", prompt: "p", provider: "claude", projectId: "p1", enabled: true, form: { preset: "hourly", time: "00:15", day: null, custom: "" } });
  expect(hourly).not.toContain('aria-label="Hour"');
  expect(hourly).toContain('aria-label="Minute"');
  expect(hourly).toContain('value="15"');
  expect(hourly).not.toContain("AM or PM");
});

test("a custom line shows the five field chips (AUTO-002)", () => {
  const html = render({ id: "a", name: "u", prompt: "p", provider: "claude", projectId: "p1", enabled: true, form: { preset: "custom", time: "", day: null, custom: "30 10 * * 2" } });
  expect(html.match(/class="chip"/g)).toHaveLength(5);
  expect(html).toContain("day of the week");
});

test("a template fills the new automation's form and the header offers the templates again (AUTO-006)", () => {
  const html = renderToString(createElement(AutomationDialog, { projects, agents: [], editing: null, template: templates[3], onClose: () => {}, onSaved: () => {} }));
  expect(html).toContain('value="Hourly upkeep"');
  expect(html).toMatch(/<option value="hourly" selected="">/);
  expect(html).toContain('value="15"');
  expect(html).toContain("Templates");
  // T-192-b: the template's grace window is filled in too (30 minutes for hourly upkeep).
  expect(html).toMatch(/<option value="30" selected="">Start it up to 30 minutes late/);
});

test("a precheck command and its 1, 2, 5 or 10 minute limit, run only ahead of timed runs (AUTO-008)", () => {
  const fresh = render(null);
  expect(fresh).toContain("Precheck command");
  expect(fresh).toMatch(/<option value="60" selected="">1 minute/);
  expect(fresh).toContain("never ahead of Run now");
  const html = render({ id: "a", name: "u", prompt: "p", provider: "claude", projectId: "p1", enabled: true, precheck: "git diff --quiet", precheckTimeoutSeconds: 300, form: { preset: "hourly", time: "00:15", day: null, custom: "" } });
  expect(html).toContain('value="git diff --quiet"');
  expect(html).toMatch(/<option value="300" selected="">5 minutes/);
});
