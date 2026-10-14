import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ACK_DELAY_MS, ACK_EVERY, batchAcks } from "./flow";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("ACCT-054: acks are batched by size or delay, totals add up, and stop drops what is pending", () => {
  const sent: number[] = [];
  const acks = batchAcks((n) => sent.push(n));
  acks.drew(100);
  acks.drew(200);
  expect(sent).toEqual([]);
  vi.advanceTimersByTime(ACK_DELAY_MS);
  expect(sent).toEqual([300]);
  acks.drew(ACK_EVERY - 1);
  expect(sent).toEqual([300]);
  acks.drew(1);
  expect(sent).toEqual([300, ACK_EVERY]);
  vi.advanceTimersByTime(ACK_DELAY_MS * 2);
  expect(sent).toEqual([300, ACK_EVERY]);
  acks.drew(5);
  acks.stop();
  vi.advanceTimersByTime(ACK_DELAY_MS * 2);
  expect(sent).toEqual([300, ACK_EVERY]);
});
