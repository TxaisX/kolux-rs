import { expect, test } from "vitest";
import { newPaceMemory, noteId, paced } from "./pace";

test("T-125-b two events from one pane with the same words in one millisecond get distinct ids and both are remembered", () => {
  const a = noteId();
  const b = noteId();
  expect(a).not.toBe(b);
  const mem = newPaceMemory();
  expect(paced(mem, "C:/w/a", a, 1_000)).toBe(true);
  expect(paced(mem, "C:/w/a", b, 1_000)).toBe(false);
  expect(mem.shown.has(a) && mem.shown.has(b)).toBe(true);
});

test("T-125-b ids count up, so a later event never sorts or compares equal to an earlier one", () => {
  const ids = Array.from({ length: 50 }, () => noteId());
  expect(new Set(ids).size).toBe(50);
  const seqs = ids.map((i) => Number(i.split(".")[1]));
  expect(seqs.every((n, i) => i === 0 || n === seqs[i - 1] + 1)).toBe(true);
});
