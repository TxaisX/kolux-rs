// T-187-b / T-189-b: the one place the "start an agent for a reason" flows meet the window. The window
// mounts <AgentStartHost> once and hands it what it knows (the agents, the saved choices, how to open a
// tab, how to make a workspace); a button anywhere (a check row, a task row, a past-session row) calls
// one of the functions below. Nothing here keeps state of its own beyond the open dialog.
import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import type { Check } from "../scm/checks";
import type { WorkItem } from "../tasks/workStart";
import type { CarrySource } from "./carry";
import { runFixChecks } from "./fixChecks";
import { runFromItem } from "./fromItem";
import type { Launch, StartAgent, StartResult } from "./rules";

export type Env = {
  agents: StartAgent[];
  defaultId: string;
  /** The agent saved for agent actions. */
  saved: unknown;
  /** The workspace in front. */
  workspace: string | null;
  launch: Launch;
  makeWorkspace: (item: WorkItem) => Promise<{ path: string }>;
  /** Shows a sentence to the person; a failure stays in the notice line, a success is a passing toast. */
  notify: (text: string, failed: boolean) => void;
  /** Workspaces already made for items, by item address; null when unknown. */
  existing?: (item: WorkItem) => string | null;
};

let env: Env | null = null;
export const setEnv = (e: Env | null) => {
  env = e;
};
export const currentEnv = (): Env | null => env;

/** The folder check of the back end (a removed worktree means no agent starts). */
export const folderReady = (dir: string): Promise<void> => invoke<void>("agent_dir_ready", { dir });

let dialog: CarrySource | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export const useCarryDialog = (): CarrySource | null =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => dialog,
  );
export const closeCarry = () => {
  dialog = null;
  emit();
};

/** SESS-031 / VIEW-087: opens the dialog to continue this session in an agent of the person's choice. */
export function askCarry(source: CarrySource) {
  dialog = source;
  emit();
}

const NOT_READY = "Kolux is still starting, so nothing was started.";

/** Says how a flow ended. */
export function report(r: StartResult, done: string) {
  env?.notify(r.ok ? done : r.message, !r.ok);
}

/** SESS-033: the fix action beside failing checks. */
export async function fixChecks(req: { dir: string | null; pr: { number: number; title?: string | null; url: string } | null; checks: Check[] }): Promise<StartResult> {
  if (!env) {
    const r: StartResult = { ok: false, stage: "launch", message: NOT_READY };
    return r;
  }
  const r = await runFixChecks({ ...req, agents: env.agents, saved: env.saved, defaultId: env.defaultId, ready: folderReady, launch: env.launch });
  report(r, "An agent started on the failing checks.");
  return r;
}

/** SESS-034: start work on an issue or pull request from its row. */
export async function startFromItem(req: { item: WorkItem; title: string; argsText?: string; /** The workspace already made for the item, when the row knows it. */ existing?: string | null }): Promise<StartResult> {
  if (!env) return { ok: false, stage: "launch", message: NOT_READY };
  env.notify(`Making a workspace for ${req.item.kind === "pull" ? "pull request" : "issue"} #${req.item.number}…`, false);
  const r = await runFromItem({ ...req, argsText: req.argsText ?? "", agents: env.agents, saved: env.saved, defaultId: env.defaultId, existing: req.existing ?? env.existing?.(req.item) ?? null, makeWorkspace: env.makeWorkspace, ready: folderReady, launch: env.launch });
  report(r, `An agent started on ${req.item.kind === "pull" ? "pull request" : "issue"} #${req.item.number}.`);
  return r;
}
