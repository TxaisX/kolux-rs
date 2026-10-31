// TERM-044 / TERM-046 / TERM-049: the close items of a tab's right-click menu, moved out of the menu's
// drawing so the five labels, their order and the pinned rules are one pure function the menu runs.
import { closeSet, type Which } from "../../terminal/tabClose";
import { bulkCloseSet } from "../../terminal/pin";

/** The menu's close rows, in the order it draws them. */
export type CloseRow = { label: string; which: Which; keys: number[]; disabled: boolean };

/** TERM-044: Close, Close others, Close to the right, Close to the left, Close all. A pinned tab is
 *  never closed by its own row or by a bulk row (TERM-046); a row that would close nothing is disabled. */
export const CLOSE_ROWS: ReadonlyArray<readonly [string, Which]> = [
  ["Close", "one"],
  ["Close others", "others"],
  ["Close to the right", "right"],
  ["Close to the left", "left"],
  ["Close all", "all"],
];

/** What each close row would close from strip `order`, and whether it can run. */
export function closeRows(order: number[], key: number, pinned: Set<number>): CloseRow[] {
  return CLOSE_ROWS.map(([label, which]) => {
    const keys = bulkCloseSet(order, key, which, pinned);
    return { label, which, keys, disabled: keys.length === 0 || (which === "one" && pinned.has(key)) };
  });
}

/** The keys a confirmed close-all would take, pinned tabs included (the question says so). */
export const allKeys = (order: number[], key: number): number[] => closeSet(order, key, "all");
