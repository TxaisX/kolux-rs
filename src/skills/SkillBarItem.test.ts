// SKILL-027: the status bar item draws nothing when idle, and the count while updating.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => new Promise(() => undefined)) }));

import SkillBarItem from "./SkillBarItem";
import SkillPill from "./SkillPill";
import { pillFor } from "./skillBar";
import { skillBar } from "./skillBarStore";

test("SKILL-027: idle draws nothing; a started update draws updating with its count, as a button", () => {
  expect(renderToString(createElement(SkillBarItem))).toBe("");
  skillBar.begin(["a", "b", "c"]);
  const html = renderToString(createElement(SkillBarItem));
  expect(html).toContain("Updating 3 skills");
  expect(html).toContain("<button");
  expect(html).toContain("skill-item info");
  skillBar.dispose();
});

test("SKILL-025: an update pill is a button into the details, an up to date pill is plain text", () => {
  const html = renderToString(createElement(SkillPill, { pill: pillFor("a", "failed", null) }));
  expect(html).toContain("<button");
  expect(html).toContain("Check failed");
  const plain = renderToString(createElement(SkillPill, { pill: pillFor("a", "idle", null) }));
  expect(plain).not.toContain("<button");
  expect(plain).toContain("Installed");
});
