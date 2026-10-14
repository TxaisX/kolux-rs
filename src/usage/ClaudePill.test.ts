import { beforeEach, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn(async () => {}) }));

import { publishLive, publishStored } from "./ClaudePill";
import { clearReadings, lineFor, readingsOf } from "./forecast";

const MIN = 60_000;
const T0 = 1_700_000_000_000;
beforeEach(() => clearReadings());

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
