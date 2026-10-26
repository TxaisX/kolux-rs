// SESS-012 box 3: Pair with a task -> each seat's first prompt begins with its role brief, then the task.
import { expect, test } from "vitest";
import { openingPrompt, pickShape, ROLE_BRIEFS, rulesBlock, withoutRules } from "../seats";

test("SESS-012 box 3: Pair with a task gives the builder and the reviewer prompts that start with their own brief, then the task", () => {
  const pair = pickShape("pair", [{ agent: "claude", model: "opus" }]);
  expect(pair.map((s) => s.role)).toEqual(["builder", "reviewer"]);
  const task = "Fix the login page";
  // Two seats side by side: the rules block (SESS-025) follows the task, so the brief and task still lead.
  const rules = rulesBlock("C:\proj\.kolux\handoffs\gentle-squid.md");
  const prompts = pair.map((s) => openingPrompt(s, task, rules));
  expect(prompts[0].startsWith(`${ROLE_BRIEFS.builder}\n\n${task}`)).toBe(true);
  expect(prompts[1].startsWith(`${ROLE_BRIEFS.reviewer}\n\n${task}`)).toBe(true);
  expect(ROLE_BRIEFS.builder).not.toBe(ROLE_BRIEFS.reviewer);
  expect(prompts.map(withoutRules)).toEqual([`${ROLE_BRIEFS.builder}\n\n${task}`, `${ROLE_BRIEFS.reviewer}\n\n${task}`]);
});
