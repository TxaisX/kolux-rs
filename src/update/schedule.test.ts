import { describe, expect, it } from "vitest";
import { CHECK_TIMEOUT_MS, INTERVAL_MS, ONLINE_DELAY_MS, RETRY_MAX_MS, UpdateSchedule, retryDelay, type Outcome } from "./schedule";

const MIN = 60_000;

// A fake clock: timers fire in order as time is advanced.
function harness(opts: { lastCheckAt: number | null; answers?: Array<"none" | "found" | "fail" | "hang"> }) {
  let now = 1_000_000_000;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const answers = [...(opts.answers ?? [])];
  const calls: number[] = [];
  const outcomes: Array<{ outcome: Outcome<string>; requested: boolean }> = [];
  let isOnline = true;
  const s = new UpdateSchedule<string>(
    {
      now: () => now,
      setTimer: (fn, ms) => {
        const id = ++seq;
        timers.set(id, { at: now + ms, fn });
        return id;
      },
      clearTimer: (h) => void timers.delete(h as number),
      online: () => isOnline,
      check: () => {
        calls.push(now);
        const a = answers.shift() ?? "none";
        if (a === "hang") return new Promise(() => {});
        if (a === "fail") return Promise.reject("network error");
        return Promise.resolve(a === "found" ? "0.2.0" : null);
      },
      onOutcome: (outcome, requested) => outcomes.push({ outcome, requested }),
    },
    opts.lastCheckAt === null ? null : now - opts.lastCheckAt,
  );
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
      await flush();
    }
    now = end;
    await flush();
  };
  return {
    s,
    calls,
    outcomes,
    advance,
    flush,
    get now() {
      return now;
    },
    setOnline: (v: boolean) => (isOnline = v),
    start0: () => now,
  };
}

describe("update timetable (APP-024)", () => {
  it("checks at start when the last check is older than the interval, then every 30 minutes", async () => {
    const h = harness({ lastCheckAt: INTERVAL_MS + MIN });
    const t0 = h.now;
    h.s.start();
    await h.flush();
    expect(h.calls).toEqual([t0]);
    await h.advance(INTERVAL_MS - 1);
    expect(h.calls.length).toBe(1);
    await h.advance(1);
    expect(h.calls).toEqual([t0, t0 + INTERVAL_MS]);
    await h.advance(INTERVAL_MS);
    expect(h.calls.length).toBe(3);
  });

  it("waits out the remainder when the last check is recent", async () => {
    const h = harness({ lastCheckAt: 10 * MIN }); // last check 10 minutes ago
    const t0 = h.now;
    h.s.start();
    await h.flush();
    expect(h.calls).toEqual([]);
    await h.advance(20 * MIN - 1);
    expect(h.calls).toEqual([]);
    await h.advance(1);
    expect(h.calls).toEqual([t0 + 20 * MIN]);
  });

  it("a first launch with no record checks at once", async () => {
    const h = harness({ lastCheckAt: null });
    h.s.start();
    await h.flush();
    expect(h.calls.length).toBe(1);
  });

  it("retries after an hour, doubling up to six hours, and returns to 30 minutes after a success", async () => {
    expect([1, 2, 3, 4, 5, 9].map(retryDelay)).toEqual([60 * MIN, 120 * MIN, 240 * MIN, RETRY_MAX_MS, RETRY_MAX_MS, RETRY_MAX_MS]);
    const h = harness({ lastCheckAt: null, answers: ["fail", "fail", "fail", "none", "none"] });
    const t0 = h.now;
    h.s.start();
    await h.flush();
    await h.advance(60 * MIN);
    await h.advance(120 * MIN);
    await h.advance(240 * MIN);
    await h.advance(INTERVAL_MS);
    expect(h.calls.map((t) => (t - t0) / MIN)).toEqual([0, 60, 180, 420, 450]);
    expect(h.s.failureCount).toBe(0);
  });

  it("background failures are reported as quiet, never as requested", async () => {
    const h = harness({ lastCheckAt: null, answers: ["fail"] });
    h.s.start();
    await h.flush();
    expect(h.outcomes).toHaveLength(1);
    expect(h.outcomes[0].requested).toBe(false);
    expect(h.outcomes[0].outcome.ok).toBe(false);
  });

  it("stays silent offline and checks within seconds of the connection coming back", async () => {
    const h = harness({ lastCheckAt: null });
    h.setOnline(false);
    h.s.start();
    await h.flush();
    expect(h.calls).toEqual([]);
    await h.advance(60 * MIN); // an hour offline: the 30-minute tick skips too
    expect(h.calls).toEqual([]);
    expect(h.outcomes.every((o) => !o.requested)).toBe(true);
    h.setOnline(true);
    const back = h.now;
    h.s.online();
    await h.advance(ONLINE_DELAY_MS);
    expect(h.calls).toEqual([back + ONLINE_DELAY_MS]);
    expect(ONLINE_DELAY_MS).toBeLessThanOrEqual(MIN);
  });

  it("merges focus checks and a requested check into the one that is running", async () => {
    const h = harness({ lastCheckAt: null, answers: ["hang"] });
    h.s.start();
    await h.flush();
    h.s.focus();
    h.s.focus();
    const asked = h.s.run(true);
    await h.flush();
    expect(h.calls.length).toBe(1);
    // The stalled check is dropped after the timeout, and the request that took it over gets the result.
    await h.advance(CHECK_TIMEOUT_MS);
    const out = await asked;
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/no answer within 45 seconds/);
    expect(h.outcomes).toHaveLength(1);
    expect(h.outcomes[0].requested).toBe(true);
  });

  it("focus checks only when the last check is out of date", async () => {
    const h = harness({ lastCheckAt: 5 * MIN });
    h.s.start();
    h.s.focus();
    await h.flush();
    expect(h.calls).toEqual([]);
    await h.advance(25 * MIN); // the timer runs the due check
    expect(h.calls.length).toBe(1);
    h.s.focus();
    await h.flush();
    expect(h.calls.length).toBe(1);
  });

  it("checks on waking from sleep when the last check is out of date", async () => {
    const h = harness({ lastCheckAt: 29 * MIN });
    h.s.start();
    await h.flush();
    h.s.tick();
    expect(h.calls).toEqual([]);
    // The PC sleeps for two hours: timers did not run, the next tick sees the gap.
    h.s.stop();
    await h.advance(120 * MIN);
    h.s.tick();
    await h.flush();
    expect(h.calls.length).toBe(1);
  });

  it("a requested check runs even offline so it can say why it failed", async () => {
    const h = harness({ lastCheckAt: 1 * MIN, answers: ["fail"] });
    h.setOnline(false);
    const out = await h.s.run(true);
    expect(h.calls.length).toBe(1);
    expect(out.ok === false && out.offline).toBe(true);
  });
});
