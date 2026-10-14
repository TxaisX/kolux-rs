import { expect, test } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { ActivityView, workTime } from "./Activity";

// Invented counts only.
const since = new Date(2026, 8, 3, 10, 0).getTime();

test("USAGE-011: three headline cards with the date counting began", () => {
  const html = renderToString(createElement(ActivityView, { counts: { since, agentsStarted: 12, workingMs: (3 * 60 + 25) * 60_000, prsCreated: 2 } }));
  expect(html).toContain("Agents started");
  expect(html).toContain(">12<");
  expect(html).toContain("3h 25m");
  expect(html).toContain("Pull requests created");
  expect(html).toMatch(/Counting since .*2026/);
  expect(html).not.toContain("No agent has run yet");
});

test("USAGE-011: before any agent has run, the page invites the first one", () => {
  const html = renderToString(createElement(ActivityView, { counts: { since, agentsStarted: 0, workingMs: 0, prsCreated: 0 } }));
  expect(html).toContain("No agent has run yet");
  expect(html).not.toContain("Agents started");
});

test("USAGE-011: working time reads in minutes, then hours and minutes", () => {
  expect([workTime(0), workTime(20_000), workTime(14 * 60_000), workTime(60 * 60_000), workTime(26 * 3_600_000 + 60_000)]).toEqual(["0m", "<1m", "14m", "1h 0m", "26h 1m"]);
});
