// The dialog's timetable fields as pure functions. AUTO-002: Custom starts from the earlier
// preset's cron line and gives back what was typed; the five field chips, the weekday names and
// the line's meaning in words follow the interface language (the window's language, through Intl).
// AUTO-003: 12-hour boxes over a 24-hour time. AUTO-006: the four starter templates.
import type { Preset, ScheduleForm } from "./model";

const pad = (n: number | string) => String(n).padStart(2, "0");
const hm = (time: string) => time.split(":").map((s) => Number(s) || 0);

/** The cron line a preset stands for, the same one the back end saves (schedule.rs preset_line). */
export function presetCron(form: ScheduleForm): string {
  const [h, m] = hm(form.time);
  switch (form.preset) {
    case "hourly":
      return `${m} * * * *`;
    case "daily":
      return `${m} ${h} * * *`;
    case "weekdays":
      return `${m} ${h} * * 1-5`;
    case "weekly":
      return `${m} ${h} * * ${form.day ?? 1}`;
    default:
      return form.custom;
  }
}

/** Moving to another timetable: Custom brings back what was typed, or else the earlier preset's line. */
export function toPreset(form: ScheduleForm, next: Preset, typed: string | null): ScheduleForm {
  if (next === "custom") return { ...form, preset: next, custom: typed ?? presetCron(form) };
  return { ...form, preset: next, time: /^\d\d:\d\d$/.test(form.time) ? form.time : "09:00", day: form.day ?? 1 };
}

export const to12 = (time: string) => {
  const [h, minute] = hm(time);
  return { hour: h % 12 || 12, minute, pm: h >= 12 };
};
export const from12 = (hour: number, minute: number, pm: boolean) => `${pad((hour % 12) + (pm ? 12 : 0))}:${pad(minute)}`;
/** A box that loses focus: out of range snaps to the nearest end, empty takes the smallest value. */
export const clampBox = (text: string, lo: number, hi: number) => {
  const n = parseInt(text, 10);
  return Number.isNaN(n) ? lo : Math.min(hi, Math.max(lo, n));
};
export const nudge = (value: number, by: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value + by));

const names = (locale: string, n: number, opt: Intl.DateTimeFormatOptions, at: (i: number) => Date) =>
  Array.from({ length: n }, (_, i) => new Intl.DateTimeFormat(locale, { ...opt, timeZone: "UTC" }).format(at(i)));
/** Sunday first; 1 January 2023 was a Sunday. */
export const weekdayNames = (locale: string) => names(locale, 7, { weekday: "long" }, (i) => new Date(Date.UTC(2023, 0, 1 + i)));
const monthNames = (locale: string) => names(locale, 12, { month: "long" }, (i) => new Date(Date.UTC(2023, i, 1)));

type DisplayNames = new (locale: string, o: { type: string }) => { of(code: string): string | undefined };
/** The five cron fields in order: minute, hour, day of the month, month, day of the week. */
export function fieldNames(locale: string): string[] {
  const english = ["minute", "hour", "day", "month", "day of the week"];
  try {
    const dn = new (Intl as unknown as { DisplayNames: DisplayNames }).DisplayNames(locale, { type: "dateTimeField" });
    return ["minute", "hour", "day", "month", "weekday"].map((k, i) => dn.of(k) ?? english[i]);
  } catch {
    return english;
  }
}

/** A five-field cron line in words, or null for anything else (an RRULE keeps the back end's sentence). */
export function cronWords(line: string, locale: string): string | null {
  const f = line.trim().split(/\s+/);
  if (f.length !== 5 || line.includes("=")) return null;
  const [mi, h, dom, mon, dow] = f;
  const num = (s: string) => /^\d+$/.test(s);
  const piece = (v: string, unit: string) => (v === "*" ? null : v.startsWith("*/") ? `every ${v.slice(2)} ${unit}s` : `${unit} ${v}`);
  const named = (v: string, list: string[], base: number) =>
    v.replace(/\d+/g, (d) => list[(Number(d) - base) % list.length] ?? d).replace(/-/g, " to ").replace(/,/g, ", ");
  const parts: string[] = [];
  if (num(mi) && num(h)) parts.push(`at ${pad(h)}:${pad(mi)}`);
  else if (num(mi) && h === "*") parts.push(`at minute ${Number(mi)} of every hour`);
  else parts.push([piece(mi, "minute"), piece(h, "hour")].filter(Boolean).join(", ") || "every minute");
  if (dom !== "*") parts.push(`on day ${dom} of the month`);
  if (mon !== "*") parts.push(`in ${named(mon, monthNames(locale), 1)}`);
  if (dow !== "*") parts.push(`on ${named(dow, weekdayNames(locale), 0)}`);
  return parts.join(" ");
}

// ponytail: graceMinutes waits for the grace window field of AUTO-007 (T-175); the dialog has none yet.
export type Template = { id: string; name: string; prompt: string; form: ScheduleForm; graceMinutes: number; blurb: string };
const at = (preset: Preset, time: string, day = 1): ScheduleForm => ({ preset, time, day, custom: "" });
/** AUTO-006: choosing one only fills the dialog; nothing is stored until Save. */
export const templates: Template[] = [
  {
    id: "audit",
    name: "Weekday repo audit",
    blurb: "Monday to Friday at 09:00",
    prompt: "Audit this repository. Look for failing tests, dependencies with known problems, warnings in the build and TODOs that have sat for a while. Report what you find, most urgent first, with the file and line for each. Do not change any files.",
    form: at("weekdays", "09:00"),
    graceMinutes: 720,
  },
  {
    id: "release",
    name: "Weekly release check",
    blurb: "Thursdays at 14:00",
    prompt: "Check whether the default branch is ready to release. Run the tests and the build, read the changes since the last release tag, and list anything that would block a release. End with a plain yes or no.",
    form: at("weekly", "14:00", 4),
    graceMinutes: 1440,
  },
  {
    id: "review",
    name: "Daily review",
    blurb: "Every day at 16:30",
    prompt: "Review today's commits on this repository. For each one, say what it changed and flag anything that looks risky, untested or unclear. Keep it short.",
    form: at("daily", "16:30"),
    graceMinutes: 180,
  },
  {
    id: "upkeep",
    name: "Hourly upkeep",
    blurb: "A quarter past every hour",
    prompt: "Do a quick upkeep pass: check that the working tree is clean, the branch is up to date with its remote and the tests still pass. Say only what needs attention.",
    form: at("hourly", "00:15"),
    graceMinutes: 30,
  },
];
