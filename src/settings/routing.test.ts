import { expect, test } from "vitest";
import { chooseModel, current, effortsFor, modelOf, withPick, routingOf, type Provider } from "./routing";

const claude: Provider = {
  id: "claude",
  name: "Claude Code",
  models: [
    { id: "opus", label: "Claude Opus", efforts: ["low", "medium", "high"] },
    { id: "sonnet", label: "Claude Sonnet", efforts: ["low", "medium", "high"] },
    { id: "haiku", label: "Claude Haiku", efforts: [] },
  ],
  defaults: [
    { model: "opus", effort: "high" },
    { model: "opus", effort: "high" },
    { model: "sonnet", effort: "medium" },
    { model: "haiku", effort: null },
  ],
};

test("a tier with nothing saved shows the shipped ladder; a saved pick wins", () => {
  expect(current(claude, "build", {})).toEqual({ model: "sonnet", effort: "medium" });
  expect(current(claude, "light", {})).toEqual({ model: "haiku", effort: "" });
  const s = withPick({ other: 1 }, "claude", "light", { model: "sonnet", effort: "low" });
  expect(s.other).toBe(1);
  expect(current(claude, "light", routingOf(s))).toEqual({ model: "sonnet", effort: "low" });
  expect(current(claude, "build", routingOf(s))).toEqual({ model: "sonnet", effort: "medium" });
});

test("a new model keeps the effort if it still offers it, resets it otherwise", () => {
  expect(chooseModel(claude, { model: "sonnet", effort: "high" }, "opus")).toEqual({ model: "opus", effort: "high" });
  expect(chooseModel(claude, { model: "sonnet", effort: "high" }, "haiku")).toEqual({ model: "haiku", effort: "" });
  expect(chooseModel(claude, { model: "sonnet", effort: "high" }, "")).toEqual({ model: "", effort: "" });
  expect(effortsFor(claude, "haiku")).toEqual([]);
});

test("the pane header reads the model from the start line", () => {
  expect(modelOf(["--permission-mode", "auto", "--model", "haiku", "--effort", "low"])).toBe("haiku");
  expect(modelOf(["--permission-mode", "auto"])).toBeNull();
});
