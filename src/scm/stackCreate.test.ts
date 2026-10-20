import { describe, expect, it } from "vitest";
import { createNext, type Call } from "./stackCreate";
import type { StackItem } from "./stack";

const pr = (number: number, head: string, base: string): StackItem => ({ number, head, base, state: "OPEN", url: `https://github.com/o/r/pull/${number}` });
const a = pr(1, "a", "main");
const b = pr(2, "b", "a");

function fake(created = { number: 3, url: "https://github.com/o/r/pull/3" }) {
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  const call: Call = async <T,>(command: string, args: Record<string, unknown>) => {
    calls.push({ command, args });
    return (command === "scm_stack_create" ? created : (args.items as { number: number }[]).map((i) => i.number)) as T;
  };
  return { call, calls };
}

describe("GIT-034 creating the next pull request of a stack", () => {
  it("makes it on top of the current branch, then records the whole chain", async () => {
    const { call, calls } = fake();
    const got = await createNext(call, "D", { open: [a, b], trunk: "main", chain: [a, b], current: "b", next: "c", title: "  Third part ", draft: true });
    expect(calls.map((c) => c.command)).toEqual(["scm_stack_create", "scm_stack_record"]);
    expect(calls[0].args).toEqual({ worktree: "D", head: "c", base: "b", title: "Third part", body: "", draft: true });
    expect(calls[1].args.items).toEqual([
      { number: 1, head: "a" },
      { number: 2, head: "b" },
      { number: 3, head: "c" },
    ]);
    expect(got).toEqual({ number: 3, url: "https://github.com/o/r/pull/3", recorded: [1, 2, 3] });
  });

  it("makes no second pull request when the branch already has one (a retry only records)", async () => {
    const c = pr(3, "c", "b");
    const { call, calls } = fake();
    const got = await createNext(call, "D", { open: [a, b, c], trunk: "main", chain: [a, b, c], current: "b", next: "c", title: "x", draft: false });
    expect(calls.map((x) => x.command)).toEqual(["scm_stack_record"]);
    expect(got.number).toBe(3);
  });

  it("refuses a branch that is the current one, one resting on something else, or a missing title, creating nothing", async () => {
    const { call, calls } = fake();
    await expect(createNext(call, "D", { open: [a, b], trunk: "main", chain: [a, b], current: "b", next: "b", title: "x", draft: false })).rejects.toThrow(/branch of its own/);
    await expect(createNext(call, "D", { open: [a, b, pr(3, "c", "a")], trunk: "main", chain: [a, b], current: "b", next: "c", title: "x", draft: false })).rejects.toThrow(/resting on a/);
    await expect(createNext(call, "D", { open: [a, b], trunk: "main", chain: [a, b], current: "b", next: "c", title: "  ", draft: false })).rejects.toThrow(/title/);
    expect(calls).toEqual([]);
  });

  it("stops with the reason when GitHub refuses, recording nothing", async () => {
    const calls: string[] = [];
    const call: Call = async (command: string) => {
      calls.push(command);
      throw new Error("HTTP 422: head branch not pushed");
    };
    await expect(createNext(call, "D", { open: [a], trunk: "main", chain: [a], current: "a", next: "b", title: "x", draft: false })).rejects.toThrow(/not pushed/);
    expect(calls).toEqual(["scm_stack_create"]);
  });
});
