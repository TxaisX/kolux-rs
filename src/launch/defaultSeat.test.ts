import { expect, test } from "vitest";
import { defaultChoices, seatDefault, seatStart, SHIPPED_DEFAULT } from "./defaultSeat";
import { DEFAULT_MODEL, TERMINAL } from "./seats";

const D = { model: "opus", effort: "xhigh" };
const none = { model: null };

test("T-571: nothing saved gives the shipped pair; an empty string saved means no default; other types are ignored", () => {
  expect(seatDefault({})).toEqual(SHIPPED_DEFAULT);
  expect(seatDefault(null)).toEqual(SHIPPED_DEFAULT);
  expect(seatDefault({ defaultModel: "sonnet", defaultEffort: "low" })).toEqual({ model: "sonnet", effort: "low" });
  expect(seatDefault({ defaultModel: "", defaultEffort: "" })).toEqual({ model: "", effort: "" });
  expect(seatDefault({ defaultModel: 5 })).toEqual(SHIPPED_DEFAULT);
});

test("T-571: Claude starts on the default model and effort", () => {
  expect(seatStart("claude", D, none)).toEqual({ agent: "claude", model: "opus", effort: "xhigh", fast: undefined });
});

test("T-571: an agent that does not list the model starts on its program default, with no effort", () => {
  expect(seatStart("codex", D, none)).toEqual({ agent: "codex", model: DEFAULT_MODEL, effort: undefined, fast: undefined });
});

test("T-571: an effort the model does not have is left out; a model without efforts gets none", () => {
  expect(seatStart("claude", { model: "haiku", effort: "high" }, none).effort).toBeUndefined();
  expect(seatStart("grok", { model: "grok-4", effort: "max" }, none).effort).toBeUndefined();
  expect(seatStart("grok", { model: "grok-4", effort: "low" }, none).effort).toBe("low");
});

test("T-571: the default beats an older per-agent saved pick; with no default the saved pick (or a blank) is used as before", () => {
  const saved = { model: "sonnet", effort: "low" };
  expect(seatStart("claude", D, saved).model).toBe("opus");
  expect(seatStart("claude", { model: "", effort: "" }, saved)).toMatchObject({ model: "sonnet", effort: "low" });
  expect(seatStart("claude", { model: "", effort: "" }, none).model).toBeNull();
});

test("T-571: a terminal seat has no model; an agent with no model list stays blank", () => {
  expect(seatStart(TERMINAL, D)).toEqual({ agent: TERMINAL, model: null, effort: undefined, fast: undefined });
  expect(seatStart("aider", D, none).model).toBeNull();
});

test("T-571: the Settings choices list each model once and the effort levels in order", () => {
  const { models, efforts } = defaultChoices();
  expect(models.map((m) => m.id)).toContain("opus");
  expect(new Set(models.map((m) => m.id)).size).toBe(models.length);
  expect(models.some((m) => m.id === DEFAULT_MODEL)).toBe(false);
  expect(efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
});
