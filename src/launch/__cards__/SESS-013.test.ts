// SESS-013 boxes through the exact call the chooser's count buttons and free field make (recount).
import { expect, test } from "vitest";
import { emptySeat, resizeLineup, type Seat } from "../seats";

const blank = (): Seat[] => [emptySeat()];

test("SESS-013 box 1: count 3 gives three empty seats; count 2 drops the third and leaves the first two as they were", () => {
  const three = resizeLineup("custom", blank(), 3);
  expect(three.seats).toEqual([emptySeat(), emptySeat(), emptySeat()]);
  const touched: Seat[] = [{ agent: "claude", model: "opus", title: "A" }, { agent: "codex", model: null }, three.seats[2]];
  const two = resizeLineup("custom", touched, 2);
  expect(two.seats).toEqual([touched[0], touched[1]]);
  expect(two.shape).toBe("custom");
});

test("SESS-013 box 2: 15 in the free field gives fifteen empty seats beside the one already picked", () => {
  const picked: Seat = { agent: "claude", model: "opus" };
  const fifteen = resizeLineup("custom", [picked], 15);
  expect(fifteen.seats).toHaveLength(15);
  expect(fifteen.seats[0]).toEqual(picked);
  expect(fifteen.seats.slice(1).every((s) => s.agent === null && s.model === null)).toBe(true);
});
