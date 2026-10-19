import { describe, expect, it } from "vitest";
import type { ProjectField, ProjectItem } from "./projects";
import { barPlace, dayNumber, dayString, defaultTimeline, itemSpan, monthTicks, timelineRange } from "./timeline";

const f = (id: string, name: string, kind: string): ProjectField => ({ id, name, kind, options: [] });
const start = f("S", "Start date", "date");
const target = f("E", "Target date", "date");
const sprint = f("I", "Sprint", "iteration");
const status = f("X", "Status", "single_select");
const cell = (text: string, days = 0) => ({ text, id: "", start: text, days });
const item = (values: ProjectItem["values"], kind = "issue"): ProjectItem => ({ id: "i", kind, title: "t", number: 1, url: "", repo: "a/b", state: "open", labels: [], assignees: [], values });

describe("T-549 roadmap timeline", () => {
  it("reads only real calendar dates", () => {
    expect(dayString(dayNumber("2026-10-14")!)).toBe("2026-10-14");
    expect(dayNumber("2024-02-29")).not.toBeNull();
    for (const d of ["2026-02-30", "2026-13-01", "14/10/2026", ""]) expect(dayNumber(d)).toBeNull();
  });

  it("opens on start and end date fields by name, else an iteration, else the first dates, and keeps a saved choice", () => {
    expect(defaultTimeline([status, sprint, target, start])).toEqual({ start: "S", end: "E" });
    expect(defaultTimeline([status, sprint])).toEqual({ start: "I", end: "I" });
    expect(defaultTimeline([target])).toEqual({ start: "E", end: "E" });
    expect(defaultTimeline([f("A", "Shipped", "date")])).toEqual({ start: "A", end: "A" });
    expect(defaultTimeline([status])).toBeNull();
    expect(defaultTimeline([start, target, sprint], { start: "I", end: "E" })).toEqual({ start: "I", end: "E" });
    expect(defaultTimeline([start, target], { start: "gone", end: "E" })).toEqual({ start: "S", end: "E" });
  });

  it("spans an item from its start to its end, an iteration to its last day, one date to one day", () => {
    const fields = [start, target, sprint];
    const d = (s: string) => dayNumber(s)!;
    expect(itemSpan(item({ S: cell("2026-10-01"), E: cell("2026-10-10") }), fields, { start: "S", end: "E" })).toEqual({ from: d("2026-10-01"), to: d("2026-10-10") });
    expect(itemSpan(item({ I: cell("2026-10-12", 14) }), fields, { start: "I", end: "I" })).toEqual({ from: d("2026-10-12"), to: d("2026-10-25") });
    expect(itemSpan(item({ E: cell("2026-10-10") }), fields, { start: "S", end: "E" })).toEqual({ from: d("2026-10-10"), to: d("2026-10-10") });
    expect(itemSpan(item({ S: cell("2026-10-10"), E: cell("2026-10-01") }), fields, { start: "S", end: "E" })).toEqual({ from: d("2026-10-10"), to: d("2026-10-10") });
    expect(itemSpan(item({}), fields, { start: "S", end: "E" })).toBeNull();
    expect(itemSpan(item({ S: cell("2026-10-01") }, "restricted"), fields, { start: "S", end: "E" })).toBeNull();
  });

  it("shows every span and today with a week either side, and places bars by day", () => {
    const today = dayNumber("2026-10-14")!;
    expect(timelineRange([], today)).toEqual({ from: today - 30, to: today + 30 });
    const r = timelineRange([{ from: today + 10, to: today + 20 }], today);
    expect(r).toEqual({ from: today - 7, to: today + 27 });
    expect(barPlace({ from: today - 7, to: today - 7 }, r)).toEqual({ left: 0, width: (1 / 35) * 100 });
    const ticks = monthTicks({ from: dayNumber("2026-10-14")!, to: dayNumber("2027-02-02")! });
    expect(ticks.map((t) => t.label)).toEqual(["Nov 2026", "Dec", "Jan 2027", "Feb"]);
    expect(dayString(ticks[0].day)).toBe("2026-11-01");
  });
});
