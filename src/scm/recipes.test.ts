import { describe, expect, it } from "vitest";
import { aiShownFor, migrateRecipes, recipeProblem, recipesOf, recipeVariables, repoAiMode, withRepoAi } from "./recipes";

describe("GIT-019 recipes", () => {
  it("offer the linked-issue variable only in the commit and pull request recipes", () => {
    expect(recipeVariables("commit")).toContain("issue");
    expect(recipeVariables("pr")).toContain("issue");
    expect(recipeVariables("branch")).not.toContain("issue");
    expect(recipeVariables("fix")).not.toContain("issue");
    expect(recipeProblem("fix", { agent: null, args: "", template: "run {issue}" })).toMatch(/only available in the commit and pull request/);
    expect(recipeProblem("commit", { agent: null, args: "", template: "write {issue} {diff}" })).toBeNull();
  });
  it("cannot be saved when invalid, and say why", () => {
    expect(recipeProblem("commit", { agent: null, args: "", template: "" })).toMatch(/Choose an agent/);
    expect(recipeProblem("commit", { agent: null, args: "--fast", template: "" })).toMatch(/need an agent/);
    expect(recipeProblem("commit", { agent: "claude", args: "", template: "x" })).toMatch(/not both/);
    expect(recipeProblem("commit", { agent: "claude", args: "a\nb", template: "" })).toMatch(/single line/);
    expect(recipeProblem("commit", { agent: "claude", args: "{diff", template: "" })).toMatch(/brace/);
    expect(recipeProblem("commit", { agent: "claude", args: "{nope}", template: "" })).toMatch(/\{nope\} is not a variable.*\{diff\}/);
    expect(recipeProblem("branch", { agent: "claude", args: "--model fast {branch}", template: "" })).toBeNull();
  });
  it("keep only well-formed saved recipes", () => {
    const got = recipesOf({ commit: { agent: "claude", args: "--x" }, pr: { template: "gen {bad}" }, fix: "no", branch: { template: "name {diff}" } });
    expect(got).toEqual({ commit: { agent: "claude", args: "--x", template: "" }, branch: { agent: null, args: "", template: "name {diff}" } });
    expect(recipesOf(null)).toEqual({});
  });
});

describe("GIT-019 configuration from before recipes", () => {
  it("becomes recipes once, from the agent chosen for every repository", () => {
    const old = { scmGenDefaults: { all: { agent: "claude", model: "m", effort: null }, repos: {} } };
    expect(migrateRecipes(old)).toEqual({ commit: { agent: "claude", args: "", template: "" }, pr: { agent: "claude", args: "", template: "" } });
    expect(migrateRecipes({ ...old, scmRecipes: {} })).toBeNull();
    expect(migrateRecipes({})).toBeNull();
    expect(migrateRecipes(null)).toBeNull();
  });
});

describe("GIT-019 per repository", () => {
  it("follows the global switch, or is forced on or off", () => {
    const s = { scmAiHidden: true, scmRepoAi: { "o/forced-on": "on", "o/forced-off": "off", "o/odd": "maybe" } };
    expect(aiShownFor(s, "o/other")).toBe(false);
    expect(aiShownFor(s, "o/forced-on")).toBe(true);
    expect(aiShownFor(s, "o/odd")).toBe(false);
    expect(aiShownFor({ scmRepoAi: { "o/forced-off": "off" } }, "o/forced-off")).toBe(false);
    expect(aiShownFor({ scmRepoAi: { "o/forced-off": "off" } }, "o/other")).toBe(true);
    expect(aiShownFor({}, null)).toBe(true);
    expect(aiShownFor({ scmAiHidden: true }, null)).toBe(false);
  });
  it("saves a mode and drops the entry when it goes back to following", () => {
    const one = withRepoAi({}, "o/r", "off");
    expect(one).toEqual({ "o/r": "off" });
    expect(repoAiMode({ scmRepoAi: one }, "o/r")).toBe("off");
    expect(withRepoAi({ scmRepoAi: one }, "o/r", "follow")).toEqual({});
    expect(repoAiMode({}, "o/r")).toBe("follow");
  });
});
