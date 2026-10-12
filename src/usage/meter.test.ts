import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { capOn, contextFill, meterOf, meterText, planOf, shortTokens, tone } from "./meter";
import Ring from "./Ring";
import type { ClaudeLimit } from "./claude";
import type { CodexUsage } from "./codex";

const claude: ClaudeLimit[] = [
  { kind: "five_hour", usedPercent: 37.6, resetsAt: null },
  { kind: "seven_day", usedPercent: 63.4, resetsAt: null },
];
const codex: CodexUsage = { state: "ok", fiveHour: { usedPercent: 12, resetsAt: null, windowMins: 300 }, weekly: null, resetCredits: null, plan: "plus", message: null };

test("context fill is measured against the 200k cap, else the model's own window (USAGE-005)", () => {
  expect(contextFill({ tokens: 100_000, window: 1_000_000 })).toBe(50);
  expect(contextFill({ tokens: 100_000, window: 1_000_000 }, false)).toBe(10);
  expect(contextFill({ tokens: 250_000, window: 200_000 })).toBe(100);
  expect(contextFill({ tokens: 5, window: 0 }, false)).toBe(0);
  // USAGE-006: the cap is on until the setting says off; a setting never saved counts as on.
  expect([capOn({}), capOn({ contextCap200k: true }), capOn({ contextCap200k: false })]).toEqual([true, true, false]);
  expect(shortTokens(84_000)).toBe("84k");
  expect(shortTokens(1_250_000)).toBe("1.3M");
  expect(shortTokens(950)).toBe("950");
  expect([tone(69), tone(70), tone(90), tone(91)]).toEqual(["", "warn", "warn", "danger"]);
});

test("plan figures follow the session's agent and vanish when the read failed (USAGE-005)", () => {
  expect(planOf("claude", claude, codex)).toEqual({ fiveHour: 38, weekly: 63 });
  expect(planOf("codex", claude, codex)).toEqual({ fiveHour: 12, weekly: null });
  expect(planOf("codex", claude, { ...codex, state: "error", fiveHour: null })).toBeNull();
  expect(planOf("claude", [], codex)).toBeNull();
  expect(planOf("shell", claude, codex)).toBeNull();
  expect(planOf("claude", [{ kind: "seven_day", usedPercent: 20, resetsAt: null }], null)).toEqual({ fiveHour: null, weekly: 20 });
});

test("the Board meter shows the context bar only after a reading, plan figures without it, and nothing with neither (USAGE-002)", () => {
  const full = meterOf({ tokens: 84_000, window: 200_000 }, "claude", claude, codex)!;
  expect(full).toEqual({ context: { tokens: 84_000, window: 200_000, percent: 42 }, plan: { fiveHour: 38, weekly: 63 } });
  expect(meterText(full)).toBe("Context 84k / 200k (42%)\n5-hour 38% · Weekly 63%");
  const fresh = meterOf(undefined, "claude", claude, codex)!;
  expect(fresh.context).toBeUndefined();
  expect(meterText(fresh)).toBe("5-hour 38% · Weekly 63%");
  expect(meterText(meterOf(undefined, "claude", [{ kind: "seven_day", usedPercent: 20, resetsAt: null }], null)!)).toBe("Weekly 20%");
  expect(meterOf(undefined, "shell", claude, codex)).toBeNull();
  expect(meterOf({ tokens: 10, window: 200_000 }, "kimi", [], null)?.plan).toBeUndefined();
});

test("the ring fills with the percentage and turns with it (USAGE-003)", () => {
  const html = renderToString(createElement(Ring, { percent: 42, size: 10, title: "Context 84k / 200k (42%)" }));
  expect(html).toContain('class="ring"');
  expect(html).toContain("<title>Context 84k / 200k (42%)</title>");
  expect(html).not.toContain("42%<");
  expect(renderToString(createElement(Ring, { percent: 95 }))).toContain('class="ring danger"');
});
