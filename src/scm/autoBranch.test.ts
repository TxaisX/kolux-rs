import { beforeEach, describe, expect, it, vi } from "vitest";
import { autoBranchOn, autoBranchPatch, forgetNamed, nameBranchFor, type NamingPorts } from "./autoBranch";
import { REPO_AI_KEY } from "./recipes";
import { SCM_AI_HIDDEN_KEY } from "./rules";

const ports = (settings: Record<string, unknown> | Error, repo: string | null = "github.com/o/r"): NamingPorts => ({
  settings: async () => {
    if (settings instanceof Error) throw settings;
    return settings;
  },
  repo: async () => repo,
});

describe("GIT-020 branch naming", () => {
  beforeEach(() => forgetNamed());
  it("is on by default and after the switch is turned on", () => {
    expect(autoBranchOn({})).toBe(true);
    expect(autoBranchOn(autoBranchPatch(true))).toBe(true);
  });
  it("respects an opt-out made after the feature existed", () => {
    expect(autoBranchOn(autoBranchPatch(false))).toBe(false);
  });
  it("counts a stray off value without a recorded choice as on once", () => {
    expect(autoBranchOn({ autoBranchName: false })).toBe(true);
  });
  it("asks the back end once per folder with the task and the writer", async () => {
    const call = vi.fn().mockResolvedValue({ renamed: true, branch: "user/fix-login", reason: null });
    const r = await nameBranchFor("C:/w/one", "fix the login bug", {}, call as never, ports({}));
    expect(r?.branch).toBe("user/fix-login");
    expect(call).toHaveBeenCalledWith("scm_name_branch", { worktree: "C:/w/one", task: "fix the login bug", writer: { agent: "claude", model: null, effort: null } });
    expect(await nameBranchFor("C:/w/one", "again", {}, call as never, ports({}))).toBeNull();
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("does nothing when switched off or the task is blank, and a failure is not an error", async () => {
    const call = vi.fn().mockRejectedValue("boom");
    expect(await nameBranchFor("C:/w/a", "x", autoBranchPatch(false), call as never)).toBeNull();
    expect(await nameBranchFor("C:/w/b", "   ", {}, call as never)).toBeNull();
    expect(call).not.toHaveBeenCalled();
    expect(await nameBranchFor("C:/w/c", "task", {}, call as never, ports({}))).toBeNull();
  });

  // Row 931: the same gate as the 915 commit writer. With AI off the back end still renames, from the
  // task's own words, so the call goes out with no writer; an agent is never named.
  const aiOffCases: [string, Record<string, unknown> | Error, string | null][] = [
    ["the global AI switch is off", { [SCM_AI_HIDDEN_KEY]: true }, "github.com/o/r"],
    ["this repository is switched off", { [REPO_AI_KEY]: { "github.com/o/r": "off" } }, "github.com/o/r"],
    ["the repository cannot be read while another one is switched off", { [REPO_AI_KEY]: { "github.com/x/y": "off" } }, null],
    ["the settings cannot be read", new Error("disk"), "github.com/o/r"],
    ["the writer is off", { commitWriter: "off" }, "github.com/o/r"],
  ];
  it.each(aiOffCases)("starts no agent when %s, and the rename is left to the task's own words", async (_n, settings, repo) => {
    const call = vi.fn().mockResolvedValue({ renamed: true, branch: "user/fix-login", reason: null });
    const r = await nameBranchFor("C:/w/gated", "fix the login bug", {}, call as never, ports(settings, repo));
    expect(r?.branch).toBe("user/fix-login");
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith("scm_name_branch", { worktree: "C:/w/gated", task: "fix the login bug", writer: null });
  });
  it("names the agent when the global switch is on and this repository follows it or is forced on", async () => {
    const call = vi.fn().mockResolvedValue({ renamed: true, branch: "user/x", reason: null });
    await nameBranchFor("C:/w/on1", "t", {}, call as never, ports({}, null));
    await nameBranchFor("C:/w/on2", "t", {}, call as never, ports({ [SCM_AI_HIDDEN_KEY]: true, [REPO_AI_KEY]: { "github.com/o/r": "on" } }));
    expect(call.mock.calls.map((c) => (c[1] as { writer: unknown }).writer)).toEqual([{ agent: "claude", model: null, effort: null }, { agent: "claude", model: null, effort: null }]);
  });
});
