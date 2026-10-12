import { expect, test } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { grid, overview, panelState, shownProviders, type Row, type Usage } from "./tokens";
import { TokenAnalyticsView } from "./TokenAnalytics";

// Invented figures only.
const row = (day: string, p: Partial<Row> = {}): Row => ({ day, session: "s", model: "m", cwd: "", band: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0, last: 0, ...p });
const saved = (rows: Row[], error: string | null = null) => ({ scannedAt: 1, rows, error });

test("USAGE-012: the overview adds Claude and Codex without counting cached input twice", () => {
  const o = overview({
    claude: [row("2026-03-01", { input: 10, cacheRead: 60, cacheWrite: 30, output: 20, reasoning: 5 }), row("2026-03-03", { input: 5, output: 5 })],
    codex: [row("2026-03-01", { input: 40, cacheRead: 60, output: 30, reasoning: 10 })],
  });
  expect(o.tokens).toBe(10 + 60 + 30 + 20 + 5 + 5 + 40 + 60 + 30);
  expect(o.mix).toEqual({ fresh: 55, cache: 150, output: 40, reasoning: 15 });
  expect(o.activeDays).toBe(2);
  expect(o.cacheShare).toBeCloseTo(120 / (55 + 150));
  expect(o.best).toEqual({ day: "2026-03-01", tokens: 250 });
  expect(o.providers).toBe(2);
  expect(overview({ claude: [], codex: [row("2026-03-02", { input: 1 })] }).providers).toBe(1);
});

test("USAGE-012: the activity grid ends this week, blank squares for days with no use, the best day marked", () => {
  const today = new Date(2026, 2, 4); // a Wednesday
  const cols = grid({ "2026-03-01": 100, "2026-03-03": 25 }, today, 2, "2026-03-01");
  expect(cols).toHaveLength(2);
  expect(cols.every((c) => c.length === 7)).toBe(true);
  const last = cols[1];
  expect(last[0].day).toBe("2026-03-01"); // Sunday starts a column
  expect(last[0]).toMatchObject({ tokens: 100, level: 4, best: true });
  expect(last[1]).toMatchObject({ day: "2026-03-02", tokens: 0, level: 0 });
  expect(last[2].level).toBeGreaterThan(0);
  expect(last[4].future).toBe(true);
  expect(cols[0][0].day).toBe("2026-02-22");
});

test("USAGE-012 / 013: off, empty and figures states, and only the tracked providers rescan", () => {
  const usage = (claude: boolean, codex: boolean, rows: Row[] = []): Usage => ({ tracking: { claude, codex }, claude: saved(rows), codex: null });
  expect(panelState(usage(false, false), "overview")).toBe("off");
  expect(panelState(usage(true, false), "overview")).toBe("empty");
  expect(panelState(usage(true, false, [row("2026-03-01", { input: 1 })]), "overview")).toBe("figures");
  expect(panelState(usage(false, true, [row("2026-03-01", { input: 1 })]), "claude")).toBe("off");
  expect(panelState(usage(false, true), "codex")).toBe("empty");
  expect(shownProviders(usage(true, false), "overview")).toEqual(["claude"]);
  expect(shownProviders(usage(true, true), "codex")).toEqual(["codex"]);
  expect(shownProviders(usage(false, true), "claude")).toEqual([]);
});

const view = (u: Usage, pick: "overview" | "claude" | "codex", scanning: string[] = []) =>
  renderToString(createElement(TokenAnalyticsView, { usage: u, pick, scanning, onPick: () => {}, onTrack: () => {}, onRefresh: () => {}, today: new Date(2026, 2, 4), filters: { range: "all", scope: "all", roots: [] }, onFilters: () => {} }));

test("USAGE-012: tracking off for both → the overview offers the two enable buttons", () => {
  const html = view({ tracking: { claude: false, codex: false }, claude: null, codex: null }, "overview");
  expect(html).toContain("Enable Claude");
  expect(html).toContain("Enable Codex");
  expect(html).not.toContain("data-activity-grid");
});

test("USAGE-012: with figures the overview shows totals, the grid and a refresh greyed out during a scan", () => {
  const u: Usage = { tracking: { claude: true, codex: true }, claude: saved([row("2026-03-01", { input: 1000, output: 500 })]), codex: saved([row("2026-03-03", { input: 200 })]) };
  const html = view(u, "overview", ["claude"]);
  expect(html).toContain("data-activity-grid");
  expect(html).toContain("1.7K");
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Refreshing/);
  expect(html).toContain("partial"); // no model has a price yet
});

test("USAGE-012 / 013: picking Codex draws only the Codex panel; off shows the explanation and a switch", () => {
  const u: Usage = { tracking: { claude: true, codex: false }, claude: saved([row("2026-03-01", { input: 1 })]), codex: null };
  const html = view(u, "codex");
  expect(html).toContain("data-panel=\"codex\"");
  expect(html).not.toContain("data-panel=\"claude\"");
  expect(html).toMatch(/role="switch"/);
  expect(html).toContain("nothing is sent anywhere");
});

test("USAGE-013: a failed scan keeps the last figures on screen and says so", () => {
  const u: Usage = { tracking: { claude: true, codex: false }, claude: saved([row("2026-03-01", { input: 1234 })], "Claude Code keeps no logs on this computer yet"), codex: null };
  const html = view(u, "claude");
  expect(html).toContain("1.2K");
  expect(html).toContain("last figures");
});
