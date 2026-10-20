import { expect, test, vi } from "vitest";

const calls: { cmd: string; args: Record<string, unknown> }[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args });
    return Promise.resolve("Add the poll");
  },
}));

const { generate, genState, DEFAULT_WRITER } = await import("./generate");
const { recipeFor, fixRequest } = await import("./recipes");
const tick = () => new Promise((r) => setTimeout(r, 0));

test("GIT-019: with a commit recipe the message comes from the recipe, else from the single writer", async () => {
  const filled: string[] = [];
  const recipe = { agent: null, args: "", template: "writer --on {branch}" };
  generate("A", (t) => filled.push(t), { ...DEFAULT_WRITER, instructions: "short" }, recipe);
  expect(genState("A")).toBe("running");
  await tick();
  expect(calls[0]).toEqual({ cmd: "scm_recipe_commit", args: { worktree: "A", recipe, instructions: "short", issue: null } });
  expect(filled).toEqual(["Add the poll"]);
  generate("B", (t) => filled.push(t), DEFAULT_WRITER);
  await tick();
  expect(calls[1].cmd).toBe("scm_commit_message");
  expect(calls[1].args).toMatchObject({ worktree: "B", agent: "claude" });
});

test("GIT-019: an action runs the saved recipe of its own name, ignoring a malformed one", () => {
  const settings = { scmRecipes: { commit: { agent: "claude", args: "--max-turns 2" }, fix: { template: "fixer {bad}" } } };
  expect(recipeFor(settings, "commit")).toEqual({ agent: "claude", args: "--max-turns 2", template: "" });
  expect(recipeFor(settings, "fix")).toBeNull();
  expect(recipeFor(settings, "pr")).toBeNull();
  expect(recipeFor(null, "commit")).toBeNull();
  expect(fixRequest("boom")).toBe("A git action in this workspace failed. Find the cause, fix it, and finish the action.\n\nGit said:\nboom");
});
