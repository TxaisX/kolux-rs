// USAGE-015 (T-137-a): estimated cost from each model's published prices. Until the price table
// lands every model counts as unpriced, so the figure reads n/a and the overview marks it partial.
import type { Provider, Row } from "./tokens";

export type Estimate = { usd: number; unpriced: string[] };

/** The dollar estimate for one provider's rows; models with no known price are left out and listed. */
export function estimate(_provider: Provider, rows: Row[]): Estimate {
  return { usd: 0, unpriced: [...new Set(rows.map((r) => r.model))].sort() };
}
