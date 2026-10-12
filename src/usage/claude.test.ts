import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { pillDetail, pillText, type ClaudeLimit } from "./claude";
import { ClaudePillView } from "./ClaudePill";

const at = new Date(2026, 9, 12, 20, 0).getTime();
const limits: ClaudeLimit[] = [
  { kind: "five_hour", usedPercent: 40, resetsAt: at },
  { kind: "seven_day", usedPercent: 63.4, resetsAt: null },
];

test("the Claude pill shows the weekly figure, else the 5-hour one, and says so when nothing was reported (STAT-040)", () => {
  expect(pillText(limits)).toBe("Claude 37% left");
  expect(pillText([limits[0]])).toBe("Claude 60% left");
  expect(pillText([])).toBe("Claude · unknown");
  expect(pillText([{ kind: "spend_limit", usedPercent: 100, resetsAt: null }])).toBe("Claude 0% left");
  expect(pillText([{ ...limits[0], usedPercent: 100 }, limits[1]])).toBe("Claude 0% left");
});

test("the hover text lists each window with its reset time", () => {
  const d = pillDetail(limits);
  expect(d.split("\n")).toEqual([expect.stringMatching(/^5-hour: 60% left, resets at \d/), "Weekly: 37% left"]);
  expect(pillDetail([])).toContain("status line");
  const html = renderToString(createElement(ClaudePillView, { limits }));
  expect(html).toContain("Claude 37% left");
  expect(html).toContain('data-claude-state="ok"');
});
