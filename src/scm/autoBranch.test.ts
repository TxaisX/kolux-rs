import { beforeEach, describe, expect, it, vi } from "vitest";
import { autoBranchOn, autoBranchPatch, forgetNamed, nameBranchFor } from "./autoBranch";

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
    const r = await nameBranchFor("C:/w/one", "fix the login bug", {}, call as never);
    expect(r?.branch).toBe("user/fix-login");
    expect(call).toHaveBeenCalledWith("scm_name_branch", { worktree: "C:/w/one", task: "fix the login bug", writer: { agent: "claude", model: null, effort: null } });
    expect(await nameBranchFor("C:/w/one", "again", {}, call as never)).toBeNull();
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("does nothing when switched off or the task is blank, and a failure is not an error", async () => {
    const call = vi.fn().mockRejectedValue("boom");
    expect(await nameBranchFor("C:/w/a", "x", autoBranchPatch(false), call as never)).toBeNull();
    expect(await nameBranchFor("C:/w/b", "   ", {}, call as never)).toBeNull();
    expect(call).not.toHaveBeenCalled();
    expect(await nameBranchFor("C:/w/c", "task", {}, call as never)).toBeNull();
  });
});
