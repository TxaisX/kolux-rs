import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { countdown, nextTick, pillDetail, pillText, weeklyLine, weeklyOf, type ClaudeLimit } from "./claude";
import { ClaudePillView } from "./ClaudePill";

const now = new Date(2026, 9, 12, 20, 0).getTime();
const limits: ClaudeLimit[] = [
  { kind: "five_hour", usedPercent: 40, resetsAt: now + 3_600_000 },
  { kind: "seven_day", usedPercent: 63.4, resetsAt: null },
];

test("the pill is the weekly window alone; without one there is nothing to show (USAGE-008)", () => {
  expect(weeklyOf(limits)).toBe(limits[1]);
  expect(pillText(limits)).toBe("Claude 37% left");
  expect(weeklyOf([limits[0]])).toBeUndefined();
  expect(pillText([limits[0]])).toBe("Claude · unknown");
  expect(pillText([{ ...limits[0], usedPercent: 100 }, limits[1]])).toBe("Claude 37% left");
});

test("the hover names the weekly limit and counts down to its reset, or says the time is unknown", () => {
  expect(pillDetail(limits, now)).toBe("Weekly limit: 37% left, reset time unknown");
  const weekly = { kind: "seven_day", usedPercent: 85, resetsAt: now + (2 * 24 + 4) * 3_600_000 + 5 * 60_000 };
  expect(pillDetail([weekly], now)).toBe("Weekly limit: 15% left, resets in 2d 4h");
  expect(countdown(now + 4 * 3_600_000 + 5 * 60_000, now)).toBe("4h 5m");
  expect(countdown(now + 12 * 60_000, now)).toBe("12m");
  expect(countdown(now - 1, now)).toBe("now");
  expect(pillDetail([{ ...weekly, resetsAt: now - 1 }], now)).toBe("Weekly limit: 15% left, resets now");
  expect(pillDetail([], now)).toContain("status line");
});

test("the pill tints on the 70/90 scale of used and only shows for an installed Claude with a weekly figure", () => {
  const html = renderToString(createElement(ClaudePillView, { limits }));
  expect(html).toContain("Claude 37% left");
  expect(html).toContain('class="usage-part"');
  expect(renderToString(createElement(ClaudePillView, { limits: [{ kind: "seven_day", usedPercent: 85, resetsAt: null }] }))).toContain('class="usage-part warn"');
  expect(renderToString(createElement(ClaudePillView, { limits: [{ kind: "seven_day", usedPercent: 95, resetsAt: null }] }))).toContain('class="usage-part danger"');
  expect(renderToString(createElement(ClaudePillView, { limits: [limits[0]] }))).toBe("");
  expect(renderToString(createElement(ClaudePillView, { limits, installed: false }))).toBe("");
});

test("T-263 USAGE-024: reset countdowns drop zero parts and tick by themselves, the nearest reset setting the rhythm", () => {
  const now = Date.UTC(2026, 9, 13, 10, 0, 0);
  const min = 60_000, hour = 3_600_000, day = 86_400_000;
  expect(countdown(now + 2 * day, now)).toBe("2d");
  expect(countdown(now + 4 * hour, now)).toBe("4h");
  expect(countdown(now + 2 * day + 30 * min, now)).toBe("2d");
  expect(countdown(now + 90_000, now)).toBe("1m");
  expect(countdown(now, now)).toBe("now");
  // The last minute: never "resets in now" while the reset is still ahead.
  expect(countdown(now + 33_000, now)).toBe("under 1m");
  expect(weeklyLine(30, now + 33_000, now)).toBe("Weekly limit: 70% left, resets in under 1m");
  expect(weeklyLine(30, now, now)).toBe("Weekly limit: 70% left, resets now");
  // 90 seconds off: the next change is just after the 30 seconds that leave one minute, then at the due moment.
  expect(nextTick([now + 90_000], now)).toBeGreaterThanOrEqual(30_000);
  expect(nextTick([now + 90_000], now)).toBeLessThan(31_000);
  expect(nextTick([now + 60_000], now)).toBeLessThan(61_000);
  // Two days off: on the hour only.
  expect(nextTick([now + 2 * day + 20 * min], now)).toBeGreaterThanOrEqual(20 * min);
  expect(nextTick([now + 2 * day + 20 * min], now)).toBeLessThan(20 * min + 1_000);
  // Several on screen: the nearest sets the rhythm; past or missing ones never tick.
  expect(nextTick([now + 2 * day + 20 * min, now + 3 * hour + 45_000, null], now)).toBeLessThan(46_000);
  expect(nextTick([now - 1, null], now)).toBeNull();
});
