// The automation dialog rendered to HTML with no browser: a new one opens on the weekday preset with
// the keep-going note, and Save stays off until the project's worktrees are read (AUTO-005).
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import AutomationDialog from "./AutomationDialog";
import type { Automation } from "./model";

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
