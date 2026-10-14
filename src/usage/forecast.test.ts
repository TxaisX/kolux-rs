import { beforeEach, expect, test } from "vitest";
import { clearReadings, forecast, forecastLine, lineFor, MIN_GAP_MS, noteAndForecast, readingsOf, record } from "./forecast";

const MIN = 60_000;
const T0 = 1_700_000_000_000;
beforeEach(() => clearReadings());

test("USAGE-031: steady climbing use gives a run-out time before the reset", () => {
  const resets = T0 + 10 * 60 * MIN;
  // 1% a minute from 40%: at minute 10 it reads 50%, so 50 minutes to go.
  for (let m = 0; m <= 10; m++) record("claude:five_hour", 40 + m, resets, T0 + m * MIN);
  const f = forecast(readingsOf("claude:five_hour"), resets, T0 + 10 * MIN);
  expect(f).toEqual({ kind: "at", at: T0 + 60 * MIN });
  expect(forecastLine(f, T0 + 10 * MIN)).toBe("At this rate: runs out in 50m, before the reset");
});

test("USAGE-031: flat or falling use, or a run-out after the reset, lasts until the reset", () => {
  const resets = T0 + 30 * MIN;
  expect(forecast([{ at: T0, used: 20 }, { at: T0 + 10 * MIN, used: 20 }], resets, T0 + 10 * MIN)).toEqual({ kind: "lasts" });
  expect(forecast([{ at: T0, used: 30 }, { at: T0 + 10 * MIN, used: 20 }], resets, T0 + 10 * MIN)).toEqual({ kind: "lasts" });
  // 1% a minute from 50% runs out at minute 60, after the reset at 30.
  expect(forecast([{ at: T0, used: 40 }, { at: T0 + 10 * MIN, used: 50 }], resets, T0 + 10 * MIN)).toEqual({ kind: "lasts" });
  expect(forecastLine({ kind: "lasts" }, T0)).toBe("At this rate: lasts until it resets");
});

test("USAGE-031: two readings under five minutes apart say nothing; five minutes is enough; 100% is now", () => {
  const just = MIN_GAP_MS - 1;
  expect(forecast([{ at: T0, used: 10 }, { at: T0 + just, used: 12 }], null, T0 + just)).toBe(null);
  expect(forecast([{ at: T0, used: 10 }, { at: T0 + MIN_GAP_MS, used: 12 }], null, T0 + MIN_GAP_MS)?.kind).toBe("at");
  expect(forecast([{ at: T0, used: 100 }], null, T0)).toEqual({ kind: "now" });
  expect(forecast([{ at: T0, used: 90 }, { at: T0 + MIN, used: 104 }], null, T0 + MIN)).toEqual({ kind: "now" });
  expect(forecastLine(null, T0)).toBe("");
});

test("USAGE-031: a reset clears the window's readings; only about the last hour counts", () => {
  record("k", 10, T0 + 100 * MIN, T0);
  record("k", 20, T0 + 100 * MIN, T0 + 10 * MIN);
  expect(readingsOf("k").length).toBe(2);
  record("k", 1, T0 + 400 * MIN, T0 + 101 * MIN); // the window started over
  expect(readingsOf("k")).toEqual([{ at: T0 + 101 * MIN, used: 1 }]);
  clearReadings();
  // A fast climb two hours ago, flat for the last hour: the old readings do not count.
  record("k", 0, null, T0);
  record("k", 50, null, T0 + 10 * MIN);
  for (let m = 60; m <= 130; m += 10) record("k", 50, null, T0 + m * MIN);
  expect(readingsOf("k")[0].at).toBeGreaterThanOrEqual(T0 + 60 * MIN);
  expect(noteAndForecast("k", 50, null, T0 + 140 * MIN)).toBe("At this rate: lasts until it resets");
});

test("USAGE-031: the pill's hover line reads the window's readings without adding one", () => {
  const resets = T0 + 10 * 60 * MIN;
  expect(lineFor("claude:seven_day", resets, T0)).toBe("");
  record("claude:seven_day", 40, resets, T0);
  record("claude:seven_day", 50, resets, T0 + 10 * MIN);
  expect(lineFor("claude:seven_day", resets, T0 + 10 * MIN)).toBe("At this rate: runs out in 50m, before the reset");
  expect(readingsOf("claude:seven_day")).toHaveLength(2);
});

test("USAGE-031 (FIX-1): a run-out already past reads 'used up now', and an unknown reset time is never named", () => {
  // the last reading is an hour old and the climb ran out half an hour ago
  expect(forecastLine({ kind: "at", at: T0 - 30 * MIN }, T0)).toBe("At this rate: used up now");
  expect(forecastLine({ kind: "at", at: T0 }, T0)).toBe("At this rate: used up now");
  expect(forecastLine({ kind: "at", at: T0 + 50 * MIN }, T0, null)).toBe("At this rate: runs out in 50m");
  record("k", 40, null, T0);
  record("k", 50, null, T0 + 10 * MIN);
  expect(lineFor("k", null, T0 + 10 * MIN)).toBe("At this rate: runs out in 50m");
  expect(noteAndForecast("k", 55, null, T0 + 15 * MIN)).not.toContain("reset");
});
