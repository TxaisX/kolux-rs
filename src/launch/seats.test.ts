import { expect, test } from "vitest";
import { allReady, clearMissing, emptySeat, modelArgs, modelsFor, resizeSeats, seatReady, TERMINAL, type Seat } from "./seats";

const claude: Seat = { agent: "claude", model: "opus" };
const term: Seat = { agent: TERMINAL, model: null };

test("SESS-013: three seats then two keeps the first two untouched; the free field can say 15; never below one", () => {
  const three = resizeSeats([claude], 3);
  expect(three).toEqual([claude, emptySeat(), emptySeat()]);
  const two = resizeSeats([claude, term, { agent: "codex", model: null }], 2);
  expect(two).toEqual([claude, term]);
  expect(resizeSeats([claude], 15)).toHaveLength(15);
  expect(resizeSeats([claude], 15).slice(1).every((s) => s.agent === null && s.model === null)).toBe(true);
  expect(resizeSeats([claude, term], 0)).toEqual([claude]);
  expect(resizeSeats([claude, term], Number.NaN)).toEqual([claude]);
  expect(resizeSeats([claude], 2.9)).toHaveLength(2);
});

test("SESS-007: an AI needs an explicit model, a terminal is ready at once, Start waits for every seat", () => {
  expect(seatReady({ agent: "claude", model: null })).toBe(false);
  expect(seatReady(claude)).toBe(true);
  expect(seatReady({ agent: "codex", model: "default" })).toBe(true);
  expect(seatReady(term)).toBe(true);
  expect(seatReady(emptySeat())).toBe(false);
  expect(allReady([claude, term])).toBe(true);
  expect(allReady([claude, emptySeat()])).toBe(false);
  expect(allReady([])).toBe(false);
});

test("a pick that stops being detected is cleared rather than swapped", () => {
  const seats = [claude, term, { agent: "grok", model: "grok-4" }];
  expect(clearMissing(seats, ["claude", "codex"])).toEqual([claude, term, emptySeat()]);
});

test("every agent gets the program default as an explicit choice; only a real model adds --model", () => {
  expect(modelsFor("claude").map((m) => m.id)).toEqual(["opus", "sonnet", "haiku", "default"]);
  expect(modelsFor("aider").map((m) => m.id)).toEqual(["default"]);
  expect(modelArgs("opus")).toEqual(["--model", "opus"]);
  expect(modelArgs("default")).toEqual([]);
  expect(modelArgs(null)).toEqual([]);
});
