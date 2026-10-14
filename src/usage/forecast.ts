// USAGE-031 (T-328): when a usage window runs out at the recent rate. Readings are kept per window
// (provider and limit kind) and cleared when that window resets; the estimate looks at roughly the
// last hour, needs two readings at least five minutes apart, says nothing about a flat or falling
// rate or a run-out after the reset (the window lasts until it resets), and treats 100% or more as
// now. The line shows in the top pill's hover (DECISIONS H default).
import { countdown } from "./claude";

export type Reading = { at: number; used: number };
export const SPAN_MS = 60 * 60_000;
export const MIN_GAP_MS = 5 * 60_000;
/** Readings kept per window: a reading a minute for well over the hour. */
const KEEP = 120;

type Window = { resetsAt: number | null; list: Reading[] };
const windows = new Map<string, Window>();

/** A window's readings as they stand (a copy). */
export const readingsOf = (key: string): Reading[] => [...(windows.get(key)?.list ?? [])];

/** Clears every window's readings (tests). */
export const clearReadings = () => windows.clear();

/** Notes one reading of window `key`. A new reset time means the window started over: its
 * readings go. Readings older than the span are dropped. */
export function record(key: string, used: number, resetsAt: number | null, now: number): void {
  let w = windows.get(key);
  if (!w || (resetsAt !== null && w.resetsAt !== null && resetsAt !== w.resetsAt) || (w.resetsAt !== null && now >= w.resetsAt)) {
    w = { resetsAt, list: [] };
    windows.set(key, w);
  }
  w.resetsAt = resetsAt ?? w.resetsAt;
  const last = w.list[w.list.length - 1];
  if (last && last.used === used && now - last.at < MIN_GAP_MS) return; // nothing new; keep the older stamp
  w.list.push({ at: now, used });
  const from = now - SPAN_MS;
  while (w.list.length > 2 && w.list[1].at <= from) w.list.shift();
  if (w.list.length > KEEP) w.list.splice(0, w.list.length - KEEP);
}

export type Forecast = { kind: "now" } | { kind: "at"; at: number } | { kind: "lasts" };

/** The estimate for `list` (oldest first) against the reset; null while there is too little to go on. */
export function forecast(list: Reading[], resetsAt: number | null, now: number): Forecast | null {
  const recent = list.filter((r) => r.at >= now - SPAN_MS - MIN_GAP_MS);
  const last = recent[recent.length - 1];
  if (last && last.used >= 100) return { kind: "now" };
  const first = recent[0];
  if (!first || !last || last.at - first.at < MIN_GAP_MS) return null;
  const rate = (last.used - first.used) / (last.at - first.at);
  if (rate <= 0) return { kind: "lasts" };
  const at = last.at + (100 - last.used) / rate;
  if (resetsAt !== null && at >= resetsAt) return { kind: "lasts" };
  return { kind: "at", at };
}

/** The hover line for a forecast, or "" when there is none. A run-out already past reads "used up
 * now" (FIX-1), and "before the reset" is said only when the reset time is known (`resetsAt`;
 * left out, it counts as known). */
export function forecastLine(f: Forecast | null, now: number, resetsAt?: number | null): string {
  if (!f) return "";
  if (f.kind === "now" || (f.kind === "at" && f.at <= now)) return "At this rate: used up now";
  if (f.kind === "lasts") return "At this rate: lasts until it resets";
  return `At this rate: runs out in ${countdown(f.at, now)}${resetsAt === null ? "" : ", before the reset"}`;
}

/** Records a reading and returns the hover line for that window. */
export function noteAndForecast(key: string, used: number, resetsAt: number | null, now: number): string {
  record(key, used, resetsAt, now);
  return forecastLine(forecast(readingsOf(key), resetsAt, now), now, resetsAt);
}

/** The hover line for window `key` from the readings so far, without adding one. */
export const lineFor = (key: string, resetsAt: number | null, now: number = Date.now()): string => forecastLine(forecast(readingsOf(key), resetsAt, now), now, resetsAt);
