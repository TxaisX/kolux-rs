import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
import { forkNotice, loadPushTarget, type PushTarget } from "./forkPush";

const t: PushTarget = { branch: "feat/login-pr-13", remote: "someone", remoteBranch: "feat/login", url: "https://github.com/someone/app.git", fork: "someone/app" };

describe("GIT-010 the fork notice", () => {
  it("names the fork, its remote and the branch name it lands under", () => {
    expect(forkNotice(t)).toBe("Pushes to the fork someone/app (remote someone) as feat/login, not to origin.");
  });
  it("leaves the branch name out when it is the same on the fork", () => {
    expect(forkNotice({ ...t, branch: "feat/login" })).toBe("Pushes to the fork someone/app (remote someone), not to origin.");
  });
  it("says nothing for a push to the project's own repository or when nothing is known", () => {
    expect(forkNotice({ ...t, fork: null })).toBeNull();
    expect(forkNotice(null)).toBeNull();
    expect(forkNotice(undefined)).toBeNull();
  });
  it("asks the back end by worktree and treats a failure as no notice", async () => {
    invoke.mockResolvedValueOnce(t);
    expect(await loadPushTarget("C:/w")).toEqual(t);
    expect(invoke).toHaveBeenCalledWith("scm_push_target", { worktree: "C:/w" });
    invoke.mockRejectedValueOnce(new Error("no git"));
    expect(await loadPushTarget("C:/w")).toBeNull();
  });
});
