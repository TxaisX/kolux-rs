// The plan figures the window knows (USAGE-005): the two top-bar pills read them and publish
// here, so Board cards can show their agent's figures without a second read.
import { useSyncExternalStore } from "react";
import type { ClaudeLimit } from "./claude";
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
