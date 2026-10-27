// Row 76 (T-226 / VIEW-074 / GIT-024): the AI draft button in the Checks pull request composer.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { cmd: string; args: Record<string, unknown> }[] = [];
let reply: (cmd: string) => unknown = () => ["Add login", "Fixes the login."];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "workspace_details_get") return { name: "Fix login", item: "https://github.com/o/r/issues/12", comment: "" };
    return reply(cmd);
  },
}));

import { applyDraft, draftOffered, draftPrText, draftRunning } from "./prDraft";

const typed = { title: "my title", body: "my words", base: "main", draft: false };
const textCalls = () => calls.filter((c) => c.cmd === "scm_pr_text");

describe("row 76 AI draft in the pull request composer", () => {
  beforeEach(() => {
    calls.length = 0;
    reply = () => ["Add login", "Fixes the login."];
  });

  it("asks scm_pr_text for the worktree and base with the saved writer, and fills the title and body", async () => {
    const r = await draftPrText("C:/w", "main", { commitWriter: "claude", commitWriterInstructions: "be brief" });
    expect(textCalls()).toHaveLength(1);
    expect(textCalls()[0].args).toMatchObject({ worktree: "C:/w", base: "main", command: null, instructions: "be brief", useTemplate: true, agent: "claude", issue: { number: 12, title: "Fix login", body: null } });
    expect(r).toEqual({ state: "filled", title: "Add login", body: "Fixes the login." });
    expect(applyDraft(typed, r)).toEqual({ ...typed, title: "Add login", body: "Fixes the login." });
    expect(draftRunning("C:/w")).toBe(false);
  });

  it("a failure names the problem and leaves what the user typed alone", async () => {
    reply = () => {
      throw new Error("claude is not signed in");
    };
    const r = await draftPrText("C:/w", "main", {});
    expect(r.state).toBe("failed");
    expect(r.state === "failed" && r.message).toContain("claude is not signed in");
    expect(applyDraft(typed, r)).toBe(typed);
    expect(draftRunning("C:/w")).toBe(false);
  });

  it("a reply with no title is a failure, not a blank fill", async () => {
    reply = () => ["  ", "text"];
    const r = await draftPrText("C:/w", "main", {});
    expect(r.state).toBe("failed");
    expect(applyDraft(typed, r)).toBe(typed);
  });

  it("while a draft is running a second ask does not call again", async () => {
    let release: (v: [string, string]) => void = () => {};
    reply = () => new Promise<[string, string]>((res) => (release = res));
    const first = draftPrText("C:/w", "main", {});
    await vi.waitFor(() => expect(textCalls()).toHaveLength(1));
    expect(draftRunning("C:/w")).toBe(true);
    const second = await draftPrText("C:/w", "main", {});
    expect(second.state).toBe("busy");
    expect(applyDraft(typed, second)).toBe(typed);
    expect(textCalls()).toHaveLength(1);
    expect(draftRunning("C:/other")).toBe(false);
    release(["T", "B"]);
    expect((await first).state).toBe("filled");
    expect(draftRunning("C:/w")).toBe(false);
  });

  it("the button follows the same switches as the Source Control writer controls", () => {
    expect(draftOffered({}, null)).toBe(true);
    expect(draftOffered({ scmAiHidden: true }, null)).toBe(false);
    expect(draftOffered({ scmAiHidden: true, scmRepoAi: { "o/r": "on" } }, "o/r")).toBe(true);
    expect(draftOffered({ scmRepoAi: { "o/r": "off" } }, "o/r")).toBe(false);
    expect(draftOffered({ commitWriter: "off" }, null)).toBe(false);
  });
});
