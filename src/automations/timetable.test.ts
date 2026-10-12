// The timetable fields' rules as pure functions: Custom starts from the preset's cron line and
// gives back what was typed (AUTO-002), the 12-hour boxes keep 24-hour time and snap on blur
// (AUTO-003), and the four starter templates (AUTO-006).
import { expect, test } from "vitest";
import { clampBox, cronWords, fieldNames, from12, nudge, presetCron, templates, to12, toPreset, weekdayNames } from "./timetable";

test("Custom opens on the earlier timetable's cron line and brings back what was typed", () => {
  const weekly = { preset: "weekly" as const, time: "10:30", day: 2, custom: "" };
  expect(presetCron(weekly)).toBe("30 10 * * 2");
  expect(toPreset(weekly, "custom", null).custom).toBe("30 10 * * 2");
  expect(toPreset({ ...weekly, preset: "hourly", time: "09:05" }, "custom", null).custom).toBe("5 * * * *");
  expect(toPreset(weekly, "custom", "0 */2 * * *").custom).toBe("0 */2 * * *");
  // a custom one saved with no clock time opens a preset at 09:00 on Monday
  expect(toPreset({ preset: "custom", time: "", day: null, custom: "x" }, "weekly", "x")).toMatchObject({ preset: "weekly", time: "09:00", day: 1 });
});

test("the 12-hour boxes keep 24-hour time", () => {
  expect(from12(1, 30, true)).toBe("13:30");
  expect(from12(12, 5, false)).toBe("00:05");
  expect(from12(12, 0, true)).toBe("12:00");
  expect(to12("00:05")).toEqual({ hour: 12, minute: 5, pm: false });
  expect(to12("13:30")).toEqual({ hour: 1, minute: 30, pm: true });
  expect(to12("12:00")).toEqual({ hour: 12, minute: 0, pm: true });
});

test("a box snaps into range when it loses focus, an empty one takes its smallest value, arrows nudge", () => {
  expect(clampBox("75", 0, 59)).toBe(59);
  expect(clampBox("", 0, 59)).toBe(0);
  expect(clampBox("", 1, 12)).toBe(1);
  expect(clampBox("0", 1, 12)).toBe(1);
  expect(clampBox("07", 0, 59)).toBe(7);
  expect(nudge(59, 1, 0, 59)).toBe(59);
  expect(nudge(3, -1, 0, 59)).toBe(2);
  expect(nudge(1, -1, 1, 12)).toBe(1);
});

test("the chips and weekday names follow the interface language", () => {
  expect(weekdayNames("en-US")[2]).toBe("Tuesday");
  expect(weekdayNames("fr-FR")[2]).toBe("mardi");
  expect(fieldNames("en-US")).toHaveLength(5);
  expect(fieldNames("fr-FR")).not.toEqual(fieldNames("en-US"));
  expect(cronWords("30 10 * * 2", "en-US")).toBe("at 10:30 on Tuesday");
  expect(cronWords("30 10 * * 2", "fr-FR")).toBe("at 10:30 on mardi");
  expect(cronWords("0 9 * * 1-5", "en-US")).toBe("at 09:00 on Monday to Friday");
  expect(cronWords("15 * * * *", "en-US")).toBe("at minute 15 of every hour");
  expect(cronWords("*/10 * * * *", "en-US")).toBe("every 10 minutes");
  expect(cronWords("0 0 29 2 *", "en-US")).toBe("at 00:00 on day 29 of the month in February");
  expect(cronWords("FREQ=DAILY", "en-US")).toBeNull();
});

test("four starter templates, each a full timetable with its grace window", () => {
  expect(templates.map((t) => [t.form.preset, t.form.time, t.form.day, t.graceMinutes])).toEqual([
    ["weekdays", "09:00", 1, 720],
    ["weekly", "14:00", 4, 1440],
    ["daily", "16:30", 1, 180],
    ["hourly", "00:15", 1, 30],
  ]);
  for (const t of templates) expect(t.name && t.prompt).toBeTruthy();
});
