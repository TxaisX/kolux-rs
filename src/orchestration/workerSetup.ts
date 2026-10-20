// ORCH-017 (T-172-d): worker-start never runs a setup script itself. Its "created" notice carries a
// setup request id; the window asks the trust question, runs the worktree's setup once in a
// background Setup tab and reports how it ended through worker_setup_settled, and only then does
// worker-start start the agent (src-tauri/src/orchestration/setup_gate.rs).
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { SetupLine } from "../projects/model";
import { askTrust, trusted, type TrustAnswer, type TrustAsk } from "../setup/TrustPrompt";

type Invoke = <T>(cmd: string, args: Record<string, unknown>) => Promise<T>;

/** How the setup of a worker start ended, as worker_setup_settled takes it. */
export type SetupAnswer = { result: "ran"; exitCode: number | null } | { result: "none" } | { result: "declined" } | { result: "error"; message: string };

/** The setup request id a "created" notice carries, when worker-start waits for its setup. */
export function setupRequestOf(notice: unknown): string | null {
  const r = (notice as { setupRequest?: unknown } | null)?.setupRequest;
  return typeof r === "string" && r !== "" ? r : null;
}

/** The trust question, then one run of the worktree's setup through `start` (which resolves with
 *  its exit code, or null when Kolux could not learn it). No script: "none"; Don't run: "declined". */
export async function gatedSetup(path: string, start: (line: SetupLine) => Promise<number | null>, invoke: Invoke = tauriInvoke, ask: (a: TrustAsk) => Promise<TrustAnswer> = askTrust): Promise<SetupAnswer> {
  try {
    const args = { local: null, policy: null };
    if (!(await trusted(path, "setup", args, invoke, ask))) return { result: "declined" };
    const line = await invoke<SetupLine | null>("workspace_setup", { path, ...args });
    if (!line) return { result: "none" };
    return { result: "ran", exitCode: await start(line) };
  } catch (err) {
    return { result: "error", message: String(err) };
  }
}

/** Reports `answer` to the worker-start waiting under `request`; false when none waits any more. */
export function settleSetup(request: string, answer: SetupAnswer, invoke: Invoke = tauriInvoke): Promise<boolean> {
  return invoke<boolean>("worker_setup_settled", {
    request,
    result: answer.result,
    exitCode: answer.result === "ran" ? answer.exitCode : null,
    message: answer.result === "error" ? answer.message : null,
  });
}
