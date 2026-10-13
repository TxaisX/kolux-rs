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
