import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { pillDetail, pillText, resetWords, type CodexUsage } from "./codex";
import { CodexPillView } from "./CodexPill";

const base: CodexUsage = { state: "ok", fiveHour: null, weekly: null, resetCredits: null, plan: null, message: null };
const now = new Date(2026, 9, 9, 12, 0);
const at = (h: number, dayOffset = 0) => new Date(2026, 9, 9 + dayOffset, h, 30).getTime() / 1000;
// the user's own clock format (12 or 24 hour), as the pill uses it
const clock = (s: number) => new Date(s * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const day = (s: number) => new Date(s * 1000).toLocaleDateString([], { weekday: "short" });

test("the pill is the weekly window alone, with a countdown to its reset (USAGE-008)", () => {
  const u = { ...base, weekly: { usedPercent: 37, resetsAt: at(9, 3), windowMins: 10080 } };
  expect(pillText(u)).toBe("Codex 63% left");
  const d = pillDetail(u, now);
  expect(d).toBe("Weekly limit: 63% left, resets in 2d 21h");
  expect(d).not.toContain("5-hour");
  expect(pillText({ ...base, fiveHour: { usedPercent: 12, resetsAt: at(14), windowMins: 300 } })).toBe("Codex · no weekly limit reported");
  expect(renderToString(createElement(CodexPillView, { usage: { ...base, fiveHour: { usedPercent: 12, resetsAt: at(14), windowMins: 300 } } }))).toBe("");
  expect(renderToString(createElement(CodexPillView, { usage: u, installed: false }))).toBe("");
  expect(renderToString(createElement(CodexPillView, { usage: { ...u, weekly: { ...u.weekly, usedPercent: 92 } } }))).toContain('class="usage-part danger"');
});

test("the 5-hour window stays out of the hover; the reset credits and plan show", () => {
  const u = { ...base, fiveHour: { usedPercent: 12, resetsAt: at(14), windowMins: 300 }, weekly: { usedPercent: 40, resetsAt: null, windowMins: 10080 }, resetCredits: 2, plan: "plus" };
  expect(pillText(u)).toBe("Codex 60% left");
  const lines = pillDetail(u, now).split("\n");
  expect(lines[0]).toBe("Weekly limit: 60% left, reset time unknown");
  expect(lines).toContain("Limit-reset credits: 2");
  expect(lines).toContain("Plan: plus");
  expect(lines.join()).not.toContain("5-hour");
  expect(resetWords(at(14), now)).toBe(`resets today ${clock(at(14))}`);
  expect(resetWords(at(9, 3), now)).toBe(`resets ${day(at(9, 3))} ${clock(at(9, 3))}`);
});

test("a refused sign-in drops the figures and warns", () => {
  const u = { ...base, state: "sign-in-again" as const, message: "Codex says this sign-in is no longer valid; sign in again" };
  expect(pillText(u)).toBe("Codex · sign in again");
  const html = renderToString(createElement(CodexPillView, { usage: u }));
  expect(html).toContain('class="usage-part warn"');
  expect(html).not.toMatch(/% left/);
  expect(pillText({ ...base, state: "signed-out" })).toBe("Codex · not signed in");
});

test("T-070 USAGE-023: a failed read keeps the figures and adds one steady error mark; a good read has none", () => {
  const u = { ...base, weekly: { usedPercent: 37, resetsAt: null, windowMins: 10080 } };
  const html = renderToString(createElement(CodexPillView, { usage: u, trouble: true }));
  expect(html).toContain("Codex 63% left");
  expect(html).toContain('data-usage-trouble="1"');
  expect(html).toContain('aria-label="last read failed"');
  expect(renderToString(createElement(CodexPillView, { usage: u }))).not.toContain("data-usage-trouble");
});
