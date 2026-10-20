// GIT-034 (T-313-b): creating the next pull request of a stack and recording the stack in every
// description. The steps are planStackedCreate's (stack.ts); the gh calls are the Rust side's
// (scm_stack_create, scm_stack_record), which write the same note block withStackNote writes. `call`
// is the Tauri invoke, passed in so a test can answer with canned results.
import { planStackedCreate, type StackItem } from "./stack";

export type Call = <T>(command: string, args: Record<string, unknown>) => Promise<T>;
export type Made = { number: number; url: string; recorded: number[] };

/**
 * Creates the pull request of `next` resting on `current` (the top of `chain`), then writes the stack
 * note into each pull request of the new chain. `open` is every open pull request of the repository.
 * A retry after a failed step makes no second pull request: planStackedCreate sees the one already open.
 */
export async function createNext(call: Call, dir: string, input: { open: StackItem[]; trunk: string; chain: StackItem[]; current: string; next: string; title: string; draft: boolean }): Promise<Made> {
  const { open, trunk, chain, current, next, title, draft } = input;
  if (!title.trim()) throw new Error("Give the new pull request a title.");
  const plan = planStackedCreate(open, trunk, current, next);
  if (plan.refused) throw new Error(plan.refused);
  let made: { number: number; url: string } | null = open.find((p) => p.head === next) ?? null;
  for (const step of plan.steps) {
    if (step === "create-current") throw new Error(`${current} has no open pull request, so the next one cannot rest on it.`);
    if (step === "create-next") made = await call<{ number: number; url: string }>("scm_stack_create", { worktree: dir, head: next, base: current, title: title.trim(), body: "", draft });
  }
  if (!made) throw new Error("The new pull request was not made.");
  const links: StackItem[] = [...chain.filter((p) => p.head !== next), { number: made.number, head: next, base: current, state: "OPEN", url: made.url }];
  const recorded = await call<number[]>("scm_stack_record", { worktree: dir, items: links.map((p) => ({ number: p.number, head: p.head })) });
  return { number: made.number, url: made.url, recorded };
}
