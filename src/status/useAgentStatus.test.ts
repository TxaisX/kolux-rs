import { expect, test } from "vitest";
import { forgetGone, takeReading, type Reading } from "./useAgentStatus";

const ev = (tokens: number | null, extra: { session?: string | null; at?: number | null } = {}) => ({ paneKey: 1, contextTokens: tokens, contextWindow: tokens === null ? null : 200_000, ...extra });

test("the newest reading takes the place of the one on screen (USAGE-001)", () => {
  const first = takeReading(undefined, undefined, ev(50_000));
  expect(first).toEqual({ tokens: 50_000, window: 200_000 });
  // Context can fall (a compact), so a smaller figure that arrives later still wins.
  expect(takeReading(first ?? undefined, undefined, ev(20_000))).toEqual({ tokens: 20_000, window: 200_000 });
  // A report with no figures is no reading and changes nothing.
  expect(takeReading(first ?? undefined, undefined, ev(null))).toBeNull();
});

test("a late reading carrying an older stamp of the same session is thrown away (USAGE-001)", () => {
  const shown: Reading = { tokens: 90_000, window: 200_000, session: "s1", at: 60_000 };
  expect(takeReading(shown, undefined, ev(40_000, { session: "s1", at: 30_000 }))).toBeNull();
  expect(takeReading(shown, undefined, ev(95_000, { session: "s1", at: 61_000 }))).toEqual({ tokens: 95_000, window: 200_000, session: "s1", at: 61_000 });
  // A new session (a /clear or another start) starts its own clock: its first reading is taken.
  expect(takeReading(shown, undefined, ev(5_000, { session: "s2", at: 1_000 }))).toEqual({ tokens: 5_000, window: 200_000, session: "s2", at: 1_000 });
});

test("after a clear forgot the reading, a straggler from before the clear is thrown away (USAGE-001)", () => {
  const floor = { session: "s1", at: 60_000 };
  expect(takeReading(undefined, floor, ev(90_000, { session: "s1", at: 59_000 }))).toBeNull();
  expect(takeReading(undefined, floor, ev(90_000, { session: "s1", at: 60_000 }))).toBeNull();
  expect(takeReading(undefined, floor, ev(10_000, { session: "s1", at: 65_000 }))).toEqual({ tokens: 10_000, window: 200_000, session: "s1", at: 65_000 });
  expect(takeReading(undefined, floor, ev(3_000, { session: "s2", at: 100 }))).toEqual({ tokens: 3_000, window: 200_000, session: "s2", at: 100 });
});

test("readings are per pane, and closing a pane forgets its reading (USAGE-001)", () => {
  const c: Record<number, Reading> = { 1: { tokens: 10, window: 100 }, 2: { tokens: 90, window: 100 } };
  const after = forgetGone(c, new Set([2]));
  expect(after).toEqual({ 2: { tokens: 90, window: 100 } });
  // Nothing closed: the same object, so React does not redraw.
  expect(forgetGone(after, new Set([2, 3]))).toBe(after);
});

test("just after a fresh start, a report whose running time the new process cannot have reached is a late one from the old process (USAGE-001)", () => {
  // Stand-in review of lane/marks 54b27f5e, AFTER 1: a status-line report in flight across /exit
  // and `claude --continue` lands on the same clock with the old 40 minutes; it must not become
  // the reading the new process's smaller figures are then compared with.
  const stale = ev(90_000, { session: "s1@2", at: 2_400_000 });
  expect(takeReading(undefined, undefined, stale, 800)).toBeNull();
  // The new process's own first report fits inside the time since its start (plus a startup margin).
  expect(takeReading(undefined, undefined, ev(30_000, { session: "s1@2", at: 1_200 }), 800)).toEqual({ tokens: 30_000, window: 200_000, session: "s1@2", at: 1_200 });
  // Past the window (or with no fresh boundary at all) the same report is an ordinary one.
  expect(takeReading(undefined, undefined, stale)).toEqual({ tokens: 90_000, window: 200_000, session: "s1@2", at: 2_400_000 });
  expect(takeReading(undefined, undefined, stale, 40_000)).toEqual({ tokens: 90_000, window: 200_000, session: "s1@2", at: 2_400_000 });
  // A report with no running time cannot be placed, so the window leaves it alone.
  expect(takeReading(undefined, undefined, ev(10_000), 800)).toEqual({ tokens: 10_000, window: 200_000 });
});
