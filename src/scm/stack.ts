// GIT-034 (T-313-b): stacked pull requests. A stack is a chain of open pull requests, each one's base
// being the previous one's branch. This holds the rules that need no GitHub call: which chain a branch
// belongs to, what creating the next pull request in it takes, the note that records the stack in each
// description (written again, never added twice), and what merging up to a chosen pull request needs.
import type { StackPr } from "./rules";

export type StackItem = StackPr & { url: string; title?: string };

export type Chain = { items: StackItem[]; error: null } | { items: []; error: string };

/** The chain `branch` belongs to, bottom (on the trunk) to top. Branching or looping links are an error. */
export function chainThrough(prs: StackItem[], trunk: string, branch: string): Chain {
  const byHead = new Map<string, StackItem[]>();
  const byBase = new Map<string, StackItem[]>();
  for (const p of prs) {
    byHead.set(p.head, [...(byHead.get(p.head) ?? []), p]);
    byBase.set(p.base, [...(byBase.get(p.base) ?? []), p]);
  }
  const fail = (error: string): Chain => ({ items: [], error });
  const mine = byHead.get(branch) ?? [];
  if (mine.length === 0) return fail(`${branch} has no open pull request`);
  if (mine.length > 1) return fail(`${branch} has more than one open pull request`);
  const down: StackItem[] = [];
  let at = mine[0];
  const seen = new Set<number>();
  for (;;) {
    if (seen.has(at.number)) return fail("the pull requests' base links loop");
    seen.add(at.number);
    down.unshift(at);
    if (at.base === trunk) break;
    const below = byHead.get(at.base) ?? [];
    if (below.length === 0) break; // rests on a branch with no open pull request: the stack starts here
    if (below.length > 1) return fail(`${at.base} has more than one open pull request`);
    at = below[0];
  }
  const up: StackItem[] = [];
  let top = mine[0];
  for (;;) {
    const above = (byBase.get(top.head) ?? []).filter((p) => !seen.has(p.number));
    if (above.length === 0) break;
    if (above.length > 1) return fail(`${top.head} is the base of ${above.length} pull requests, so the stack does not form one chain`);
    seen.add(above[0].number);
    up.push(above[0]);
    top = above[0];
  }
  return { items: [...down, ...up], error: null };
}

/** The pull request after `number` in the chain, or null for the top. */
export const nextInStack = (items: StackItem[], number: number): StackItem | null => {
  const i = items.findIndex((p) => p.number === number);
  return i >= 0 && i + 1 < items.length ? items[i + 1] : null;
};

export type CreateStep = "create-current" | "create-next" | "record";
export type CreatePlan = { steps: CreateStep[]; refused: string | null };

/**
 * Creating a pull request stacked on the current branch: the current branch's pull request comes
 * first (when it has none), then the new one (unless the branch already has one: a retry never makes
 * a second), then the stack is recorded. Parent links that do not form one chain create nothing.
 */
export function planStackedCreate(open: StackItem[], trunk: string, current: string, next: string): CreatePlan {
  const refuse = (refused: string): CreatePlan => ({ steps: [], refused });
  if (!current || !next || current === next) return refuse("The new pull request needs a branch of its own, on top of the current one.");
  const hasCurrent = open.some((p) => p.head === current);
  const hasNext = open.find((p) => p.head === next);
  if (hasNext && hasNext.base !== current) return refuse(`${next} already has a pull request, resting on ${hasNext.base} rather than ${current}.`);
  // The chain as it will be: the open pull requests, plus stand-ins for the ones about to be made.
  const future: StackItem[] = [...open];
  if (!hasCurrent) future.push({ number: -1, head: current, base: trunk, state: "OPEN", url: "" });
  if (!hasNext) future.push({ number: -2, head: next, base: current, state: "OPEN", url: "" });
  const chain = chainThrough(future, trunk, next);
  if (chain.error) return refuse(chain.error);
  // A sibling resting on the same branch as a link of the chain (the chain walks through `next`, not up from it).
  for (const link of chain.items) {
    const kids = future.filter((p) => p.base === link.head);
    if (kids.length > 1) return refuse(`${link.head} is the base of ${kids.length} pull requests, so the stack does not form one chain`);
  }
  const steps: CreateStep[] = [];
  if (!hasCurrent) steps.push("create-current");
  if (!hasNext) steps.push("create-next");
  steps.push("record");
  return { steps, refused: null };
}

const START = "<!-- kolux-stack:start -->";
const END = "<!-- kolux-stack:end -->";

/** The block that records the stack in a description, the pull request `number` marked as this one. */
export function stackNote(items: StackItem[], number: number): string {
  const rows = items.map((p) => (p.number === number ? `- **#${p.number}** (this pull request) ${p.head}` : `- #${p.number} ${p.head}`));
  return [START, "Stack (bottom first):", ...rows, END].join("\n");
}

/** `body` with its stack block replaced (or added at the end); applying it twice changes nothing more. */
export function withStackNote(body: string, items: StackItem[], number: number): string {
  const note = stackNote(items, number);
  const a = body.indexOf(START);
  const b = body.indexOf(END);
  if (a >= 0 && b > a) return body.slice(0, a) + note + body.slice(b + END.length);
  return body.trimEnd() ? `${body.trimEnd()}\n\n${note}\n` : `${note}\n`;
}

export type MergePlan = { order: number[]; refused: string | null; confirm: string };

/**
 * Merging everything up to pull request `upTo`, lowest first. `holds` says, per number, why a pull
 * request cannot merge now (empty: it can). Refused when any open pull request from the bottom up
 * to the chosen one cannot.
 */
export function mergeThrough(items: StackItem[], upTo: number, holds: Record<number, string | null | undefined>): MergePlan {
  const end = items.findIndex((p) => p.number === upTo);
  if (end < 0) return { order: [], refused: `#${upTo} is not in this stack`, confirm: "" };
  const order = items.slice(0, end + 1).filter((p) => p.state === "OPEN").map((p) => p.number);
  for (const n of order) {
    const hold = holds[n];
    if (hold) return { order: [], refused: `#${n} cannot merge yet (${hold}), so nothing was merged${n === upTo ? "" : ` up to #${upTo}`}.`, confirm: "" };
  }
  const list = order.map((n) => `#${n}`).join(", ");
  return { order, refused: null, confirm: order.length === 0 ? "" : `Merge ${order.length === 1 ? list : `${list} in this order`}?` };
}
