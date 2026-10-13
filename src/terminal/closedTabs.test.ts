// TERM-047: three closed tabs come back in reverse order; after 11 closes only the 10 newest are kept;
// a folder whose path form is gone is remapped to another spelling, else to the fallback.
import { expect, test } from "vitest";
import { CLOSED_MAX, pathForms, remember, reopen } from "./closedTabs";

const tab = (n: number, cwd = "G:\\Dev\\x") => ({ key: n, cwd });

test("closing three tabs and reopening three times brings all three back in reverse order", () => {
  let ring = [tab(1), tab(2), tab(3)].reduce((r, t) => remember(r, t), [] as ReturnType<typeof tab>[]);
  const back: number[] = [];
  for (let i = 0; i < 4; i++) {
    const r = reopen(ring, () => true, "G:\\home");
    ring = r.ring;
    if (r.tab) back.push(r.tab.key);
  }
  expect(back).toEqual([3, 2, 1]);
});

test("after closing 11 tabs, reopen brings back at most the 10 most recent", () => {
  let ring: ReturnType<typeof tab>[] = [];
  for (let n = 1; n <= 11; n++) ring = remember(ring, tab(n));
  expect(ring).toHaveLength(CLOSED_MAX);
  expect(ring.map((t) => t.key)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
});

test("a folder whose path form is gone is remapped to a spelling that exists, else the fallback", () => {
  expect(pathForms("G:\\Dev\\x")).toEqual(["G:\\Dev\\x", "G:/Dev/x", "/g/Dev/x"]);
  expect(pathForms("/g/Dev/x")).toEqual(["/g/Dev/x", "G:\\Dev\\x", "G:/Dev/x"]);
  expect(pathForms("relative/dir")).toEqual(["relative/dir"]);
  const ring = [tab(1, "/g/Dev/x"), tab(2, "Z:\\gone")];
  const first = reopen(ring, (p) => p === "G:\\Dev\\x", "G:\\home");
  expect(first.tab).toEqual({ key: 1, cwd: "G:\\Dev\\x" });
  const second = reopen(first.ring, () => false, "G:\\home");
  expect(second.tab).toEqual({ key: 2, cwd: "G:\\home" });
  expect(reopen(second.ring, () => true, "G:\\home")).toEqual({ tab: null, ring: [] });
});
