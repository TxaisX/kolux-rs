// TERM-044 / TERM-046 / TERM-049: the tab menu's close rows. What each row closes and when it is
// disabled is decided here; the menu only draws it (shell/window/Dialogs.tsx).
import { expect, test } from "vitest";
import { closeRows } from "./tabMenu";

const rows = (order: number[], key: number, pinned: number[] = []) => closeRows(order, key, new Set(pinned));

test("TERM-044: the tab menu's five close rows, in order, and what each would close", () => {
  expect(rows([1, 2, 3], 2)).toEqual([
    { label: "Close", which: "one", keys: [2], disabled: false },
    { label: "Close others", which: "others", keys: [1, 3], disabled: false },
    { label: "Close to the right", which: "right", keys: [3], disabled: false },
    { label: "Close to the left", which: "left", keys: [1], disabled: false },
    { label: "Close all", which: "all", keys: [1, 2, 3], disabled: false },
  ]);
});

test("TERM-046: a pinned tab's own row is disabled, the bulk rows skip pinned tabs, and a row with nothing to close is disabled", () => {
  const pinned = rows([1, 2, 3], 2, [2]);
  expect(pinned[0]).toMatchObject({ keys: [], disabled: true });
  expect(pinned[1].keys).toEqual([1, 3]);
  expect(pinned[4].keys).toEqual([1, 3]);
  // The first tab has nothing to its left; the last has nothing to its right.
  expect(rows([1, 2, 3], 1)[3]).toMatchObject({ keys: [], disabled: true });
  expect(rows([1, 2, 3], 3)[2]).toMatchObject({ keys: [], disabled: true });
  expect(rows([1, 2, 3], 1)[2].keys).toEqual([2, 3]);
  // A key that is not in the strip closes nothing at all.
  expect(rows([1, 2, 3], 9).every((r) => r.disabled)).toBe(true);
});
