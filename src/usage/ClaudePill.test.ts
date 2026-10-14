import { beforeEach, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn(async () => {}) }));

import { publishLive, publishStored } from "./ClaudePill";
import { clearReadings, lineFor, readingsOf } from "./forecast";
import { publishClaude } from "./plan";

const MIN = 60_000;
const T0 = 1_700_000_000_000;
beforeEach(() => {
  clearReadings();
  publishClaude([]);
});

// FIX-2 (council FS-4): a live report that carried only the five-hour window comes merged with the
// weekly window kept from an older report; that kept weekly figure is not a reading stamped now.
test("FIX-2 (USAGE-031): only the windows a live report carried become forecast readings", () => {
  const resets = T0 + 3 * 24 * 60 * MIN;
  const week = { kind: "seven_day", usedPercent: 40, resetsAt: resets };
  publishLive([week, { kind: "five_hour", usedPercent: 10, resetsAt: T0 + 60 * MIN }], T0);
  expect(readingsOf("claude:seven_day")).toEqual([{ at: T0, used: 40 }]);
  // ten minutes on, a report with only the five-hour window, merged with the kept weekly one
  publishLive([week, { kind: "five_hour", usedPercent: 20, resetsAt: T0 + 60 * MIN }], T0 + 10 * MIN, ["five_hour"]);
  expect(readingsOf("claude:seven_day")).toEqual([{ at: T0, used: 40 }]);
  expect(readingsOf("claude:five_hour").map((r) => r.used)).toEqual([10, 20]);
  // without the carried list, a window that matches what is shown is taken as kept
  publishLive([week, { kind: "five_hour", usedPercent: 30, resetsAt: T0 + 60 * MIN }], T0 + 20 * MIN);
  expect(readingsOf("claude:seven_day")).toEqual([{ at: T0, used: 40 }]);
  expect(readingsOf("claude:five_hour").map((r) => r.used)).toEqual([10, 20, 30]);
});

test("FIX-1 (USAGE-031): the stored last report is never a forecast reading stamped now; live reports are", () => {
  const resets = T0 + 3 * 24 * 60 * MIN;
  // yesterday's 40% comes back from the stored report at start, then today's live 52% arrives
  publishStored([{ kind: "seven_day", usedPercent: 40, resetsAt: resets }]);
  expect(readingsOf("claude:seven_day")).toEqual([]);
  publishLive([{ kind: "seven_day", usedPercent: 52, resetsAt: resets }], T0);
  expect(readingsOf("claude:seven_day")).toEqual([{ at: T0, used: 52 }]);
  // the timer re-reads the same stored report ten minutes on: still no reading, so no "runs out in"
  publishStored([{ kind: "seven_day", usedPercent: 52, resetsAt: resets }]);
  expect(lineFor("claude:seven_day", resets, T0 + 10 * MIN)).toBe("");
  // a second live report five minutes or more after the first does make a forecast
  publishLive([{ kind: "seven_day", usedPercent: 53, resetsAt: resets }], T0 + 10 * MIN);
  expect(lineFor("claude:seven_day", resets, T0 + 10 * MIN)).toMatch(/^At this rate: /);
});
