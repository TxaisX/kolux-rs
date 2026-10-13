import { expect, test } from "vitest";
import { costOf, estimate, priceOf, type Entry } from "./pricing";
import type { Row } from "./tokens";

// Invented token counts only; prices are the public ones in pricing.ts.
const row = (model: string, p: Partial<Row> = {}): Row => ({ day: "2026-10-01", session: "s", model, cwd: "", band: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0, last: 0, ...p });
const M = 1_000_000;

test("USAGE-015: 1M tokens of 1-hour cache writes cost twice the base input price; 5-minute writes 1.25 times", () => {
  expect(costOf("claude", row("claude-opus-4-5", { cacheWrite: M, cacheWrite1h: M })).usd).toBeCloseTo(10);
  expect(costOf("claude", row("claude-opus-4-5", { cacheWrite: M })).usd).toBeCloseTo(6.25);
  // a mixed bucket is split without charging a token twice
  expect(costOf("claude", row("claude-opus-4-5", { cacheWrite: M, cacheWrite1h: 300_000 })).usd).toBeCloseTo(0.7 * 6.25 + 0.3 * 10);
  // a 1-hour count bigger than the total is cut back to the total
  expect(costOf("claude", row("claude-opus-4-5", { cacheWrite: M, cacheWrite1h: 5 * M })).usd).toBeCloseTo(10);
});

test("USAGE-015: moving writes into the 1-hour bucket never makes an estimate smaller", () => {
  let prev = 0;
  for (const h of [0, 250_000, 500_000, M]) {
    const usd = costOf("claude", row("claude-haiku-5-5", { cacheWrite: M, cacheWrite1h: h, band: 1 })).usd;
    expect(usd).toBeGreaterThanOrEqual(prev);
    prev = usd;
  }
});

test("USAGE-015: Claude input, cache reads and output each use the family's own prices", () => {
  expect(costOf("claude", row("claude-opus-5-5", { input: M, cacheRead: M, output: M })).usd).toBeCloseTo(4 + 0.2 + 20);
  expect(costOf("claude", row("claude-opus-4-1-20250805", { input: M })).usd).toBeCloseTo(15); // never a newer family's price
  expect(costOf("claude", row("claude-3-5-haiku-20241022", { output: M })).usd).toBeCloseTo(4);
  expect(costOf("claude", row("claude-fable-5-1", { cacheRead: M })).usd).toBeCloseTo(0.25);
});

test("USAGE-015: unknown point releases, aliases and effort endings", () => {
  expect(priceOf("claude", "claude-opus-5-7", "2026-10-01")).toMatchObject({ id: "claude-opus-5-5", inferred: true }); // newer: the family's current price
  expect(priceOf("claude", "claude-opus-4-9", "2026-10-01")).toMatchObject({ id: "claude-opus-4-8", inferred: true }); // between: never the newer one
  expect(priceOf("claude", "claude-opus-3", "2026-10-01")).toBeNull(); // older than any known release
  expect(priceOf("claude", "opus", "2026-10-01")).toMatchObject({ id: "claude-opus-5-5", inferred: true });
  expect(priceOf("claude", "sonnet[1m]", "2026-10-01")).toMatchObject({ id: "claude-sonnet-5-5", inferred: true });
  expect(priceOf("claude", "claude-sonnet-4-5-20250929", "2026-10-01")).toMatchObject({ id: "claude-sonnet-4-5", inferred: false });
  expect(priceOf("claude", "claude-opus-5-5-high", "2026-10-01")).toMatchObject({ id: "claude-opus-5-5", inferred: false });
  expect(priceOf("claude", "claude-zeta-1", "2026-10-01")).toBeNull();
  expect(priceOf("claude", "gpt-5.4", "2026-10-01")).toBeNull(); // another provider's model is not priced here
});

test("USAGE-015: flat long-context prices stay flat; Haiku 5.5 pays more for prompts over 100k", () => {
  const small = costOf("claude", row("claude-opus-4-6", { input: M, output: M })).usd;
  expect(costOf("claude", row("claude-opus-4-6", { input: M, output: M, band: 2 })).usd).toBeCloseTo(small);
  expect(costOf("claude", row("claude-haiku-5-5", { input: M, output: M })).usd).toBeCloseTo(0.1 + 0.5);
  expect(costOf("claude", row("claude-haiku-5-5", { input: M, output: M, band: 1 })).usd).toBeCloseTo(0.5 + 2.5);
});

test("USAGE-015: Codex charges uncached and cached input apart, long prompts at the long-context price", () => {
  expect(costOf("codex", row("gpt-5.4", { input: M, cacheRead: M, output: M })).usd).toBeCloseTo(2.5 + 0.25 + 15);
  expect(costOf("codex", row("gpt-5.4", { input: M, cacheRead: M, output: M, band: 3 })).usd).toBeCloseTo(5 + 0.5 + 22.5);
  expect(priceOf("codex", "gpt-5.3-codex", "2026-10-01")).toMatchObject({ id: "gpt-5.3-codex", inferred: false });
  expect(priceOf("codex", "gpt-5.1-codex-max-high", "2026-10-01")).toMatchObject({ id: "gpt-5.1", inferred: true });
  expect(priceOf("codex", "gpt-5.1-codex-mini", "2026-10-01")).toMatchObject({ id: "gpt-5-mini", inferred: true });
  expect(priceOf("codex", "gpt-5.5-pro", "2026-10-01")).toMatchObject({ id: "gpt-5.5-pro" });
  expect(costOf("codex", row("gpt-5.5-pro", { cacheRead: M })).usd).toBeCloseTo(30); // no cached price: full input price
});

test("USAGE-015: a Codex session on a model with no known price keeps its tokens and name, and the cost is partial", () => {
  const e = estimate("codex", [row("gpt-5.4", { input: M }), row("codex-made-up-model", { input: 5 * M })]);
  expect(e.usd).toBeCloseTo(2.5);
  expect(e.unpriced).toEqual(["codex-made-up-model"]);
  expect(costOf("codex", row("codex-made-up-model", { input: M }))).toMatchObject({ usd: 0, priced: false });
});

test("USAGE-015: past days are charged at the price that applied to them", () => {
  const table: Entry[] = [
    { provider: "claude", id: "claude-demo-1", from: "", rates: { input: 1, hit: 0.1, output: 5 } },
    { provider: "claude", id: "claude-demo-1", from: "2026-06-01", rates: { input: 3, hit: 0.3, output: 15 } },
  ];
  expect(costOf("claude", row("claude-demo-1", { day: "2026-05-31", input: M }), table).usd).toBeCloseTo(1);
  expect(costOf("claude", row("claude-demo-1", { day: "2026-06-01", input: M }), table).usd).toBeCloseTo(3);
  expect(estimate("claude", [row("claude-demo-1", { day: "2026-05-31", input: M }), row("claude-demo-1", { day: "2026-07-01", input: M })], table).usd).toBeCloseTo(4);
});
