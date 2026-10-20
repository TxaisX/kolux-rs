import { expect, test, vi } from "vitest";

const answers: Record<string, { ok: boolean; value: string }[]> = {};
const pending: Record<string, (v: { ok: boolean; value: string }) => void> = {};
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: { worktree: string }) => {
    if (cmd === "scm_commit_message_stop") {
      pending[args.worktree]?.({ ok: false, value: "stopped" });
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      pending[args.worktree] = (v) => (v.ok ? resolve(v.value) : reject(v.value));
      const a = answers[args.worktree]?.shift();
      if (a) pending[args.worktree](a);
    });
  },
}));

const { generate, genState, stopGenerate } = await import("./generate");
const tick = () => new Promise((r) => setTimeout(r, 0));

test("GIT-017: a generation fills only the box of the worktree that began it, and a stop leaves it unchanged", async () => {
  const filled: [string, string][] = [];
  const fill = (text: string, dir: string) => filled.push([dir, text]);
  generate("A", fill);
  expect(genState("A")).toBe("running");
  expect(genState("B")).toBeNull();
  // The user switches to B meanwhile; A's answer still lands in A only.
  pending.A({ ok: true, value: "Add the poll" });
  await tick();
  expect(filled).toEqual([["A", "Add the poll"]]);
  expect(genState("A")).toBeNull();
  // Stopping mid-run fills nothing and shows no error.
  generate("B", fill);
  await stopGenerate("B");
  await tick();
  expect(filled).toHaveLength(1);
  expect(genState("B")).toBeNull();
  // A failure stays with its worktree as an error to show.
  answers.C = [{ ok: false, value: "The agent failed: no key" }];
  generate("C", fill);
  await tick();
  expect(genState("C")).toBe("The agent failed: no key");
});

test("GIT-018: the commit-message writer is Claude Code by default, can be a custom command or off", async () => {
  const { writerOf, WRITER_KEY, WRITER_COMMAND_KEY, WRITER_INSTRUCTIONS_KEY } = await import("./generate");
  expect(writerOf({})).toEqual({ mode: "agent", agent: "claude", model: null, effort: null, command: null, instructions: "" });
  expect(writerOf({ [WRITER_KEY]: "custom", [WRITER_COMMAND_KEY]: "  tool {prompt} ", [WRITER_INSTRUCTIONS_KEY]: "Be brief" })).toMatchObject({ mode: "custom", command: "tool {prompt}", instructions: "Be brief" });
  // A custom choice with no command is not usable, so nothing is offered.
  expect(writerOf({ [WRITER_KEY]: "custom", [WRITER_COMMAND_KEY]: " " }).mode).toBe("off");
  expect(writerOf({ [WRITER_KEY]: "off" }).mode).toBe("off");
  expect(writerOf({ [WRITER_KEY]: 7 })).toMatchObject({ mode: "agent", agent: "claude" });
});

test("GIT-018 (T-228-d): another agent, a model and an effort are chosen by their settings; an unknown agent falls back to Claude Code", async () => {
  const { writerOf, writerArgs, WRITER_KEY, WRITER_MODEL_KEY, WRITER_EFFORT_KEY } = await import("./generate");
  const w = writerOf({ [WRITER_KEY]: "codex", [WRITER_MODEL_KEY]: " gpt-x ", [WRITER_EFFORT_KEY]: "high" });
  expect(w).toMatchObject({ mode: "agent", agent: "codex", model: "gpt-x", effort: "high" });
  expect(writerArgs(w)).toEqual({ agent: "codex", model: "gpt-x", effort: "high" });
  expect(writerOf({ [WRITER_KEY]: "nobody-knows" })).toMatchObject({ agent: "claude", model: null });
  expect(writerOf({ [WRITER_KEY]: "kimi", [WRITER_MODEL_KEY]: "   " }).model).toBeNull();
  expect(writerArgs(writerOf({ [WRITER_KEY]: "off" }))).toEqual({});
});
