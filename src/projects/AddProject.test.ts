// PROJ-002: the Add Project dialog's first step and its keys.
import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AddProjectView, nextChoice } from "./AddProject";

const noop = () => {};

test("arrow keys move between the three choices and wrap; other keys leave focus alone", () => {
  expect(nextChoice("ArrowDown", 0)).toBe(1);
  expect(nextChoice("ArrowRight", 1)).toBe(2);
  expect(nextChoice("ArrowDown", 2)).toBe(0);
  expect(nextChoice("ArrowUp", 0)).toBe(2);
  expect(nextChoice("ArrowLeft", 2)).toBe(1);
  expect(nextChoice("Enter", 1)).toBeNull();
  expect(nextChoice("a", 0)).toBeNull();
});

test("cloning is the main choice, with Browse then New project beside it", () => {
  const html = renderToString(createElement(AddProjectView, { step: "choose", onStep: noop, onBrowse: noop, onClose: noop }));
  expect(html).toContain('role="dialog"');
  const clone = html.indexOf("Clone from a URL");
  const browse = html.indexOf("Open a folder");
  const fresh = html.indexOf("New project");
  expect(clone).toBeGreaterThan(-1);
  expect(clone).toBeLessThan(browse);
  expect(browse).toBeLessThan(fresh);
  // Only the clone choice is the primary button.
  expect(html.match(/add-choice primary/g)).toHaveLength(1);
  expect(html.slice(html.lastIndexOf("<button", clone), clone)).toContain("primary");
});

test("the clone and new steps say plainly what works today and lead back", () => {
  for (const step of ["clone", "new"] as const) {
    const html = renderToString(createElement(AddProjectView, { step, onStep: noop, onBrowse: noop, onClose: noop }));
    expect(html).toContain("Back");
    expect(html).toContain("Open a folder");
  }
  const clone = renderToString(createElement(AddProjectView, { step: "clone", onStep: noop, onBrowse: noop, onClose: noop }));
  expect(clone).toContain('aria-label="repository URL"');
  expect(clone).toMatch(/<button[^>]*disabled[^>]*>Clone<\/button>/);
});
