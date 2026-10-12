import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { KITS } from "./catalog";
import KitStrip, { kitRows } from "./KitStrip";
import { datedName, matchSeats, roleDone, rolePrompt, roleRow, seatTitle, type RunCheck } from "./run";

const sheet = KITS.find((k) => k.id === "spreadsheet")!;
const [analyst, report, checker] = sheet.roles;
const T0 = 1_000_000;
const run = (files: RunCheck["files"] = {}): RunCheck => ({
  record: { kit: "spreadsheet", title: sheet.title, started: T0, roles: [{ id: "analyst", ai: "claude" }, { id: "report", ai: "codex" }, { id: "checker", ai: "grok" }] },
  files,
});

test("a seat is titled with its role and AI", () => {
  expect(seatTitle(analyst, "claude")).toBe("Analyst · Claude");
  expect(seatTitle(checker, "grok")).toBe("Checker · Grok");
});

test("a role's prompt has the user's inputs in and the rules naming its own files", () => {
  const p = rolePrompt(sheet, analyst, { data: "G:/shop/sales.csv", question: "Which month was best?" });
  expect(p).toContain("Study the table in G:/shop/sales.csv. Answer this question if one is given: Which month was best?");
  expect(p).toContain("Produce exactly these files in kit-results/analyst/: findings.md.");
  expect(p).toContain("Write only inside the folder kit-results/analyst/");
  expect(p).toContain("one-line file named DONE in kit-results/analyst/");
  expect(p).toContain("never edit, move or delete");
  expect(p).toContain("inline SVG");
  expect(p).not.toContain("\n");
  // A blank optional input leaves no placeholder behind.
  const blank = rolePrompt(sheet, analyst, { data: "G:/shop/sales.csv" });
  expect(blank).not.toMatch(/\{\w+\}/);
  expect(blank).toContain("if one is given: .");
});

test("the dated folder follows the collected-folder pattern", () => {
  expect(datedName("Fake Kit", new Date(2026, 0, 15, 9, 5).getTime())).toBe("Fake Kit – Jan 15 2026, 9.05 AM");
  expect(datedName("Fake Kit", new Date(2026, 9, 12, 0, 8).getTime())).toBe("Fake Kit – Oct 12 2026, 12.08 AM");
  expect(datedName("Fake Kit", new Date(2026, 9, 12, 13, 40).getTime())).toBe("Fake Kit – Oct 12 2026, 1.40 PM");
});

test("done needs this run's marker; an older marker does not count", () => {
  expect(roleDone(run({ analyst: { DONE: T0 + 5 } }), "analyst")).toBe(true);
  expect(roleDone(run({ analyst: { DONE: T0 - 5 } }), "analyst")).toBe(false);
  expect(roleDone(run(), "analyst")).toBe(false);
});

test("each role row says what its AI is up to", () => {
  const seat = { key: 7, running: true };
  const now = T0 + 30_000;
  // Done wins even while the session still looks busy.
  expect(roleRow(sheet, analyst, run({ analyst: { DONE: T0 + 1 } }), seat, null, now)).toEqual({ state: "done", text: "Done", key: 7 });
  expect(roleRow(sheet, analyst, run(), seat, null, now).text).toBe("Working");
  expect(roleRow(sheet, analyst, run(), seat, null, T0 + 3 * 60_000 + 5).text).toBe("Working, 3 min");
  expect(roleRow(sheet, checker, run(), seat, null, now).text).toBe("Waiting on Analyst");
  expect(roleRow(sheet, checker, run(), seat, T0 + 60_000, T0 + 2 * 60_000).text).toBe("Working, 1 min");
  expect(roleRow(sheet, analyst, run(), { key: 7, running: true, needs: true }, null, now).text).toBe("Needs you");
  expect(roleRow(sheet, analyst, run(), { key: 7, running: false }, null, now).state).toBe("stopped");
  // No session: a file from before this run is left from the last run, else not ready yet.
  expect(roleRow(sheet, report, run({ report: { "report.html": T0 - 1 } }), null, null, now)).toEqual({ state: "left", text: "Left from the last run", key: null });
  expect(roleRow(sheet, report, run(), null, null, now).text).toBe("Not ready yet");
});

test("sessions are tied to roles by the saved mapping, else by AI and launch order", () => {
  const record = run().record;
  const panes = [
    { key: 1, ai: "claude" },
    { key: 2, ai: "codex" },
    { key: 3, ai: "grok" },
    { key: 4, ai: "claude" },
  ];
  expect(matchSeats(record, [4, 2, 3], panes)).toEqual([4, 2, 3]);
  // A saved mapping with a closed session falls back; one session is never used twice.
  expect(matchSeats(record, [9, 2, 3], panes)).toEqual([1, 2, 3]);
  const twoClaude = { ...record, roles: [{ id: "analyst", ai: "claude" }, { id: "report", ai: "claude" }, { id: "checker", ai: "claude" }] };
  expect(matchSeats(twoClaude, null, panes)).toEqual([1, 4, null]);
});

test("the strip counts done roles and folds away its rows", () => {
  const check = run({ analyst: { DONE: T0 + 1, "findings.md": T0 + 1 } });
  const seats = [{ key: 1, running: true }, { key: 2, running: true }, { key: 3, running: true }];
  const rows = kitRows(check, seats, {}, T0 + 10);
  expect(rows.map((r) => r.text)).toEqual(["Done", "Working", "Waiting on Analyst"]);
  const noop = () => {};
  const open = renderToString(createElement(KitStrip, { check, seats, sent: {}, now: T0 + 10, folded: false, onFold: noop, onOpen: noop, onFocusSeat: noop }));
  expect(open).toContain("1<!-- --> of <!-- -->3<!-- --> done");
  expect(open).toContain("Open results");
  expect(open).toContain("Analyse a spreadsheet");
  expect(open.match(/class="kit-strip-row /g)?.length).toBe(3);
  const folded = renderToString(createElement(KitStrip, { check, seats, sent: {}, now: T0 + 10, folded: true, onFold: noop, onOpen: noop, onFocusSeat: noop }));
  expect(folded).not.toContain("kit-strip-row");
});
