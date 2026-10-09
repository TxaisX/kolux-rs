import { expect, test } from "vitest";
import { confirmDelete, lastRun, matches, normalizeQuery, noFilters, passes, PROMPT_SEARCH_CHARS, sortRows, type Automation, type Names, type Run } from "./model";

const names: Names = { project: (id) => ({ p1: "shop", p2: "blog" })[id] ?? id, agent: (id) => ({ claude: "Claude Code", codex: "Codex" })[id] ?? id };
const auto = (id: string, name: string, extra: Partial<Automation> = {}): Automation => ({ id, name, prompt: "", provider: "claude", projectId: "p1", enabled: true, ...extra });
const run = (automationId: string, at: number, status: Run["status"] = "completed", number = 1): Run => ({ id: `r-${automationId}-${at}`, automationId, number, trigger: "manual", status, at });

test("names sort the way people count: 2 before 10, case ignored", () => {
  const list = [auto("a", "Run 10"), auto("b", "run 2"), auto("c", "Run 1")];
  expect(sortRows(list, [], "name", false, names).map((a) => a.name)).toEqual(["Run 1", "run 2", "Run 10"]);
  expect(sortRows(list, [], "name", true, names).map((a) => a.name)).toEqual(["Run 10", "run 2", "Run 1"]);
});

test("sort by last run: newest first, never-run automations at the end either way", () => {
  const list = [auto("never", "Never ran"), auto("old", "Old"), auto("new", "New")];
  const runs = [run("old", 1000), run("new", 5000), run("old", 2000, "failed", 2)];
  expect(sortRows(list, runs, "lastRun", false, names).map((a) => a.id)).toEqual(["new", "old", "never"]);
  expect(sortRows(list, runs, "lastRun", true, names).map((a) => a.id)).toEqual(["old", "new", "never"]);
  expect(lastRun("old", runs)?.status).toBe("failed");
});

test("search finds a word that appears only inside the prompt, within its first 2,048 characters", () => {
  const deep = auto("a", "Nightly", { prompt: "Check the  Flaky\tTests in CI" });
  const tooDeep = auto("b", "Late", { prompt: "x".repeat(PROMPT_SEARCH_CHARS) + " zebra" });
  const q = normalizeQuery("  flaky   TESTS ")!;
  expect(q).toBe("flaky tests");
  expect(matches(deep, q, names)).toBe(true);
  expect(matches(tooDeep, normalizeQuery("zebra")!, names)).toBe(false);
  expect(matches(deep, "shop", names)).toBe(true); // the project's name
  expect(matches(deep, "claude code", names)).toBe(true); // the agent's name
  expect(matches(auto("c", "x", { workspace: "C:\\ws\\shop\\jade-seal" }), "jade-seal", names)).toBe(true);
  expect(normalizeQuery("a".repeat(201))).toBeNull();
});

test("filters: on or paused, the last run's result, and several agents at once", () => {
  const list = [auto("a", "A"), auto("b", "B", { enabled: false, provider: "codex" }), auto("c", "C", { provider: "gemini" })];
  const runs = [run("a", 10, "failed"), run("b", 10, "completed")];
  const pick = (f: Partial<typeof noFilters>) => list.filter((a) => passes(a, { ...noFilters, ...f }, runs)).map((a) => a.id);
  expect(pick({ state: "paused" })).toEqual(["b"]);
  expect(pick({ state: "on" })).toEqual(["a", "c"]);
  expect(pick({ result: "failed" })).toEqual(["a"]);
  expect(pick({ result: "never" })).toEqual(["c"]);
  expect(pick({ agents: ["claude", "codex"] })).toEqual(["a", "b"]);
});

test("the delete confirmation is on unless switched off", () => {
  expect(confirmDelete({})).toBe(true);
  expect(confirmDelete({ confirmAutomationDelete: false })).toBe(false);
});
