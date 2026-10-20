import { beforeEach, describe, expect, test } from "vitest";
import { forgetRename, onRename, promptTarget, renameError, renameOn, renameOnFirstPrompt, type RenameAnswer } from "./renameOnWork";

const ok: RenameAnswer = { renamed: true, reason: null, old: "tx/amber-otter", branch: "tx/fix-login", name: "Fix login", tracking: null };

describe("T-107-d: the first prompt names the branch once", () => {
  beforeEach(() => forgetRename());

  test("both switches must be on", () => {
    expect(renameOn({})).toBe(true);
    expect(renameOn({ renameBranches: false })).toBe(false);
    expect(renameOn({ autoBranchName: false, autoBranchChosen: true })).toBe(false);
    expect(renameOn({ autoBranchName: false })).toBe(true);
  });

  test("asks the back end once per folder with the writer, and never again after an answer", async () => {
    const calls: unknown[] = [];
    const call = (async (cmd: string, args: unknown) => (calls.push([cmd, args]), ok)) as never;
    const seen: unknown[] = [];
    const off = onRename((e) => seen.push(e));
    expect(await renameOnFirstPrompt("C:/w/one", "fix the login bug", {}, call)).toEqual(ok);
    expect(calls).toEqual([["workspace_rename_on_first_prompt", { path: "C:/w/one", task: "fix the login bug", writer: { agent: "claude", model: null, effort: null } }]]);
    expect(await renameOnFirstPrompt("C:/w/one", "again", {}, call)).toBeNull();
    expect(calls).toHaveLength(1);
    expect(seen).toEqual([{ dir: "C:/w/one", answer: ok, error: null }]);
    off();
    // a refusal from the back end also counts as tried
    const refused = { ...ok, renamed: false, reason: "This workspace has a name of its own, so its branch keeps it." };
    const refuse = (async () => refused) as never;
    expect(await renameOnFirstPrompt("C:/w/two", "task", {}, refuse)).toEqual(refused);
    expect(await renameOnFirstPrompt("C:/w/two", "task", {}, call)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  test("a switch that is off, a blank task or a writer set to nobody", async () => {
    const calls: unknown[] = [];
    const call = (async (cmd: string, args: unknown) => (calls.push([cmd, args]), ok)) as never;
    expect(await renameOnFirstPrompt("C:/w/a", "x", { renameBranches: false }, call)).toBeNull();
    expect(await renameOnFirstPrompt("C:/w/b", "   \n ", {}, call)).toBeNull();
    expect(calls).toEqual([]);
    await renameOnFirstPrompt("C:/w/c", "x", { commitWriter: "off" }, call);
    expect(calls).toEqual([["workspace_rename_on_first_prompt", { path: "C:/w/c", task: "x", writer: null }]]);
  });

  test("a failed rename keeps its complete output and lets a later prompt try again; success clears it (STAT-039)", async () => {
    let fail = true;
    const call = (async () => {
      if (fail) throw new Error("fatal: cannot lock ref 'refs/heads/tx/x': is at abc but expected def");
      return ok;
    }) as never;
    expect(await renameOnFirstPrompt("C:/w/err", "fix", {}, call)).toBeNull();
    expect(renameError("C:/w/err")).toContain("cannot lock ref");
    fail = false;
    expect(await renameOnFirstPrompt("C:/w/err", "fix", {}, call)).toEqual(ok);
    expect(renameError("C:/w/err")).toBeNull();
  });

  test("a status report with a prompt points at the pane's folder; one without is ignored", () => {
    const cwdOf = (k: number) => (k === 4 ? "C:/w/four" : undefined);
    expect(promptTarget({ paneKey: 4, prompt: "  fix the build " }, cwdOf)).toEqual({ dir: "C:/w/four", prompt: "fix the build" });
    expect(promptTarget({ paneKey: 4 }, cwdOf)).toBeNull();
    expect(promptTarget({ paneKey: 9, prompt: "x" }, cwdOf)).toBeNull();
    expect(promptTarget({ prompt: "x" }, cwdOf)).toBeNull();
  });
});
