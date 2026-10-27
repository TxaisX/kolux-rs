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

import { writerOf, writerUsable } from "./generate";
import { applyDraft, applyIfUnchanged, draftOffered, draftPrText, draftRunning } from "./prDraft";

const typed = { title: "my title", body: "my words", base: "main", draft: false };
const claudeIn = { repo: null, agents: [{ id: "claude", installed: true }] };
const textCalls = () => calls.filter((c) => c.cmd === "scm_pr_text");

describe("row 76 AI draft in the pull request composer", () => {
  beforeEach(() => {
    calls.length = 0;
    reply = () => ["Add login", "Fixes the login."];
  });

  it("asks scm_pr_text for the worktree and base with the saved writer, and fills the title and body", async () => {
    const r = await draftPrText("C:/w", "main", { commitWriter: "claude", commitWriterInstructions: "be brief" }, claudeIn);
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
    const r = await draftPrText("C:/w", "main", {}, claudeIn);
    expect(r.state).toBe("failed");
    expect(r.state === "failed" && r.message).toContain("claude is not signed in");
    expect(applyDraft(typed, r)).toBe(typed);
    expect(draftRunning("C:/w")).toBe(false);
  });

  it("a reply with no title is a failure, not a blank fill", async () => {
    reply = () => ["  ", "text"];
    const r = await draftPrText("C:/w", "main", {}, claudeIn);
    expect(r.state).toBe("failed");
    expect(applyDraft(typed, r)).toBe(typed);
  });

  it("while a draft is running a second ask does not call again", async () => {
    let release: (v: [string, string]) => void = () => {};
    reply = () => new Promise<[string, string]>((res) => (release = res));
    const first = draftPrText("C:/w", "main", {}, claudeIn);
    await vi.waitFor(() => expect(textCalls()).toHaveLength(1));
    expect(draftRunning("C:/w")).toBe(true);
    const second = await draftPrText("C:/w", "main", {}, claudeIn);
    expect(second.state).toBe("busy");
    expect(applyDraft(typed, second)).toBe(typed);
    expect(textCalls()).toHaveLength(1);
    expect(draftRunning("C:/other")).toBe(false);
    release(["T", "B"]);
    expect((await first).state).toBe("filled");
    expect(draftRunning("C:/w")).toBe(false);
  });

  it("the button follows the same switches as the Source Control writer controls", () => {
    expect(draftOffered({}, null, claudeIn.agents)).toBe(true);
    expect(draftOffered({ scmAiHidden: true }, null, claudeIn.agents)).toBe(false);
    expect(draftOffered({ scmAiHidden: true, scmRepoAi: { "o/r": "on" } }, "o/r", claudeIn.agents)).toBe(true);
    expect(draftOffered({ scmRepoAi: { "o/r": "off" } }, "o/r", claudeIn.agents)).toBe(false);
    expect(draftOffered({ commitWriter: "off" }, null, claudeIn.agents)).toBe(false);
  });

  // F1: a draft takes ~30 s; the fields stay editable meanwhile and typed text must survive.
  describe("applyIfUnchanged (text typed while the draft ran)", () => {
    const snap = { title: "t0", body: "b0" };
    const filled = { state: "filled", title: "Add login", body: "Fixes it." } as const;
    const cur = { title: "t0", body: "b0", base: "main", draft: false };

    it("fills both fields and says nothing when neither changed", () => {
      expect(applyIfUnchanged(cur, snap, filled)).toEqual({ draft: { ...cur, title: "Add login", body: "Fixes it." }, note: null });
    });
    it("keeps an edited title, fills the untouched description, and says so", () => {
      const out = applyIfUnchanged({ ...cur, title: "mine" }, snap, filled);
      expect(out.draft).toEqual({ ...cur, title: "mine", body: "Fixes it." });
      expect(out.note).toMatch(/title/);
      expect(out.note).not.toMatch(/description/);
    });
    it("keeps an edited description, fills the untouched title, and says so", () => {
      const out = applyIfUnchanged({ ...cur, body: "mine" }, snap, filled);
      expect(out.draft).toEqual({ ...cur, title: "Add login", body: "mine" });
      expect(out.note).toMatch(/description/);
    });
    it("applies nothing when both were edited", () => {
      const edited = { ...cur, title: "x", body: "y" };
      const out = applyIfUnchanged(edited, snap, filled);
      expect(out.draft).toBe(edited);
      expect(out.note).toMatch(/title and description/);
    });
    it("a failed or busy draft changes nothing and adds no note", () => {
      expect(applyIfUnchanged(cur, snap, { state: "failed", message: "no" })).toEqual({ draft: cur, note: null });
      expect(applyIfUnchanged(cur, snap, { state: "busy" })).toEqual({ draft: cur, note: null });
    });
  });

  // F2: the gate is re-checked against the settings read at click time, inside draftPrText.
  it("with the writer switched off after the composer opened, nothing is called", async () => {
    const r = await draftPrText("C:/w", "main", { commitWriter: "off" }, claudeIn);
    expect(r.state).toBe("off");
    expect(textCalls()).toHaveLength(0);
    expect(applyDraft(typed, r)).toBe(typed);
    expect(draftRunning("C:/w")).toBe(false);
  });
  it("with the AI switch off for the repository, nothing is called", async () => {
    const r = await draftPrText("C:/w", "main", { scmRepoAi: { "o/r": "off" } }, { repo: "o/r", agents: claudeIn.agents });
    expect(r.state).toBe("off");
    expect(textCalls()).toHaveLength(0);
  });

  // F3: the Source Control writer also needs the chosen agent installed, or a custom command or recipe.
  it("the chosen agent not installed and no custom command: not offered, nothing called", async () => {
    const none = [{ id: "claude", installed: false }];
    expect(draftOffered({}, null, none)).toBe(false);
    expect(draftOffered({}, null, [])).toBe(false);
    expect(draftOffered({ commitWriter: "codex" }, null, claudeIn.agents)).toBe(false);
    expect(draftOffered({ commitWriter: "codex" }, null, [{ id: "codex", installed: true }])).toBe(true);
    expect(draftOffered({ commitWriter: "custom", commitWriterCommand: "my-writer" }, null, none)).toBe(true);
    expect((await draftPrText("C:/w", "main", {}, { repo: null, agents: none })).state).toBe("off");
    expect(textCalls()).toHaveLength(0);
  });
  it("the Source Control panel and the composer share one usability rule", () => {
    const agents = [{ id: "claude", installed: false }];
    expect(writerUsable(writerOf({}), agents, null)).toBe(false);
    expect(writerUsable(writerOf({}), agents, { agent: null, args: "", template: "x" })).toBe(true);
    expect(writerUsable(writerOf({ commitWriter: "off" }), [{ id: "claude", installed: true }], null)).toBe(false);
  });
});
