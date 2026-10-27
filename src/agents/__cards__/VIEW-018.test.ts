// VIEW-018 acceptance: the Agents rail's footer line, the real usageLine fed into the real AgentsRail.
// MIRROR src/App.tsx:2287 footer = usageLine(agent, plan.claude, codexOf(...), readsLeft(settings)); the decision is usageLine/readsLeft.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { ClaudeLimit } from "../../usage/claude";
import { readsLeft, usageLine } from "../../usage/meter";
import AgentsRail from "../AgentsRail";

const status = () => ({ word: "Idle", tone: "", explain: "" });
const rail = (footer: string) =>
  renderToStaticMarkup(
    createElement(AgentsRail, { groups: [{ id: "claude", name: "Claude", sessions: [{ key: 1, agent: "claude" }] }] as never, selected: 1, classic: false, statusOf: status as never, ringOf: () => null, footer, onSelect: () => {}, onAdd: () => {}, onSettings: () => {} }),
  );

test("box 1: Claude at 37.6 % used, preference used, shows 38 % and a local reset time on the rail footer", () => {
  const now = new Date(2026, 9, 12, 12, 0, 0);
  const at = new Date(2026, 9, 12, 15, 0, 0).getTime(); // 15:00 on the viewer's own clock
  const claude: ClaudeLimit[] = [{ kind: "five_hour", usedPercent: 37.6, resetsAt: at }];
  const settings = { usageReads: "used" };
  expect(readsLeft(settings)).toBe(false);
  const line = usageLine("claude", claude, null, readsLeft(settings), now);
  expect(line).toMatch(/^Claude 38% used · resets today (15|0?3)[:.]00/);
  expect(line).not.toContain("NaN");
  const html = rail(line);
  expect(html).toContain('class="rail-foot"');
  expect(html).toMatch(/Claude 38% used · resets today (15|0?3)[:.]00/);
});

test("box 2: a provider with no 5-hour window leaves the usage line empty and draws no footer", () => {
  const now = new Date(2026, 9, 12, 12, 0, 0);
  const weeklyOnly: ClaudeLimit[] = [{ kind: "seven_day", usedPercent: 80, resetsAt: null }];
  const line = usageLine("claude", weeklyOnly, null, false, now);
  expect(line).toBe("");
  expect(rail(line)).not.toContain("rail-foot");
  expect(usageLine("codex", [], { state: "ok", fiveHour: null, weekly: { usedPercent: 10, resetsAt: 1, windowMins: 10080 }, resetCredits: null, plan: null, message: null }, false, now)).toBe("");
});
