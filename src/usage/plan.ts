// The plan figures the window knows (USAGE-005): the two top-bar pills read them and publish
// here, so Board cards can show their agent's figures without a second read.
import { useEffect, useState, useSyncExternalStore } from "react";
import { nextTick, type ClaudeLimit } from "./claude";
import type { CodexUsage } from "./codex";

export type Plan = { claude: ClaudeLimit[]; codex: CodexUsage | null };

let plan: Plan = { claude: [], codex: null };
const subs = new Set<() => void>();
const publish = (next: Plan) => {
  plan = next;
  subs.forEach((f) => f());
};
export const publishClaude = (claude: ClaudeLimit[]) => publish({ ...plan, claude });
export const publishCodex = (codex: CodexUsage | null) => publish({ ...plan, codex });
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};
const read = () => plan;

export const usePlan = (): Plan => useSyncExternalStore(subscribe, read, read);

/** USAGE-024: re-renders the caller each time the nearest of these resets (ms) changes its countdown. */
export function useResetTick(resets: (number | null | undefined)[]): void {
  const [, bump] = useState(0);
  const key = resets.join(",");
  useEffect(() => {
    const at = key.split(",").map((r) => (r ? Number(r) : null));
    let timer: number | undefined;
    const arm = () => {
      const ms = nextTick(at);
      if (ms !== null) timer = window.setTimeout(() => (bump((n) => n + 1), arm()), ms);
    };
    arm();
    return () => window.clearTimeout(timer);
  }, [key]);
}
