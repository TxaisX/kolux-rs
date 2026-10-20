import { expect, test } from "vitest";
import { agentChoices, agentPatch, effortsFor, modelMode, modelPatch, pickerHint, type WriterOptions } from "./writerPick";

const codex: WriterOptions = {
  agent: "codex",
  name: "Codex",
  installed: true,
  models: [
    { id: "m-big", name: "Big", efforts: ["low", "high", "max"] },
    { id: "m-small", name: "Small", efforts: [] },
  ],
  efforts: ["low", "medium"],
  hint: null,
};

test("GIT-018: only installed agents are offered, and the chosen one stays so the select is never blank", () => {
  const ids = (s: ReadonlySet<string> | null, c: string) => agentChoices(s, c).map((a) => a.id);
  expect(ids(new Set(["claude", "pi"]), "claude")).toEqual(["claude", "pi"]);
  expect(ids(new Set(["claude"]), "codex")).toEqual(["claude", "codex"]);
  expect(agentChoices(new Set(["claude"]), "codex").find((a) => a.id === "codex")?.installed).toBe(false);
  expect(ids(null, "claude")).toHaveLength(8);
});

test("GIT-018: the efforts offered come from the model, else from the agent; none before the list is read", () => {
  expect(effortsFor(codex, "m-big")).toEqual(["low", "high", "max"]);
  expect(effortsFor(codex, "m-small")).toEqual(["low", "medium"]);
  expect(effortsFor(codex, null)).toEqual(["low", "medium"]);
  expect(effortsFor(null, "m-big")).toEqual([]);
});

test("GIT-018: a new agent clears the model and effort; a new model keeps an effort only if it takes it", () => {
  expect(agentPatch("codex")).toEqual({ commitWriter: "codex", commitWriterModel: "", commitWriterEffort: "" });
  expect(modelPatch(codex, "m-big", "max")).toEqual({ commitWriterModel: "m-big" });
  expect(modelPatch(codex, "m-small", "max")).toEqual({ commitWriterModel: "m-small", commitWriterEffort: "" });
  expect(modelPatch(codex, "", "medium")).toEqual({ commitWriterModel: "" });
});

test("GIT-018: no installed CLI means an empty list with a hint, and a free model field", () => {
  const missing: WriterOptions = { agent: "kimi", name: "Kimi", installed: false, models: [], efforts: [], hint: "Kimi is not installed on this computer, so there is no model list to show." };
  expect(modelMode(missing)).toBe("free");
  expect(pickerHint(missing)).toContain("not installed");
  expect(modelMode(codex)).toBe("list");
  expect(modelMode(null)).toBe("free");
  expect(pickerHint(null)).toContain("Reading");
});
