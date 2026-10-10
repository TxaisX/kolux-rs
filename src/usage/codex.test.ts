import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { pillDetail, pillText, type CodexUsage } from "./codex";
import { CodexPillView } from "./CodexPill";

const base: CodexUsage = { state: "ok", fiveHour: null, weekly: null, resetCredits: null, plan: null, message: null };
const now = new Date(2026, 9, 9, 12, 0);
const at = (h: number, dayOffset = 0) => new Date(2026, 9, 9 + dayOffset, h, 30).getTime() / 1000;
// the user's own clock format (12 or 24 hour), as the pill uses it
const clock = (s: number) => new Date(s * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const day = (s: number) => new Date(s * 1000).toLocaleDateString([], { weekday: "short" });

test("a weekly-only plan shows only the weekly figure, with its reset time", () => {
  const u = { ...base, weekly: { usedPercent: 37, resetsAt: at(9, 3), windowMins: 10080 } };
  expect(pillText(u)).toBe("Codex 63% left");
  const d = pillDetail(u, now);
  expect(d).toBe(`Weekly: 63% left, resets ${day(at(9, 3))} ${clock(at(9, 3))}`);
  expect(d).not.toContain("5-hour");
});

test("both windows keep their own reset times, and the reset credits show", () => {
  const u = { ...base, fiveHour: { usedPercent: 12, resetsAt: at(14), windowMins: 300 }, weekly: { usedPercent: 40, resetsAt: at(9, 2), windowMins: 10080 }, resetCredits: 2, plan: "plus" };
  expect(pillText(u)).toBe("Codex 60% left");
  const lines = pillDetail(u, now).split("\n");
  expect(lines[0]).toBe(`5-hour: 88% left, resets today ${clock(at(14))}`);
  expect(lines[1]).toBe(`Weekly: 60% left, resets ${day(at(9, 2))} ${clock(at(9, 2))}`);
  expect(lines).toContain("Limit-reset credits: 2");
});

test("a refused sign-in drops the figures and warns", () => {
  const u = { ...base, state: "sign-in-again" as const, message: "Codex says this sign-in is no longer valid; sign in again" };
  expect(pillText(u)).toBe("Codex · sign in again");
  const html = renderToString(createElement(CodexPillView, { usage: u }));
  expect(html).toContain('class="usage-part warn"');
  expect(html).not.toMatch(/% left/);
  expect(pillText({ ...base, state: "signed-out" })).toBe("Codex · not signed in");
});
