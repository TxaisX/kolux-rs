// TERM-044 / TERM-049: which tabs a bulk close takes, and where focus lands when the active tab
// goes. Pure; the strip's order is the cell's pane order, the recent list is newest first.
export type Which = "one" | "others" | "right" | "left" | "all";

/** The tabs a close item takes from strip `order`, relative to tab `at`; empty when nothing would close. */
export function closeSet(order: number[], at: number, which: Which): number[] {
  const i = order.indexOf(at);
  if (i < 0) return [];
  switch (which) {
    case "one":
      return [at];
    case "others":
      return order.filter((k) => k !== at);
    case "right":
      return order.slice(i + 1);
    case "left":
      return order.slice(0, i);
    case "all":
      return [...order];
  }
}

/** The tab to show once `closing` (the active one first) leave: the survivor used most recently,
 *  else the active tab's right neighbour, else the one on its left; null when none survive. */
export function returnTab(order: number[], closing: number[], recent: number[]): number | null {
  const gone = new Set(closing);
  const stays = (k: number) => order.includes(k) && !gone.has(k);
  const used = recent.find(stays);
  if (used !== undefined) return used;
  const i = order.indexOf(closing[0]);
  return order.slice(i + 1).find(stays) ?? order.slice(0, Math.max(i, 0)).reverse().find(stays) ?? null;
}
