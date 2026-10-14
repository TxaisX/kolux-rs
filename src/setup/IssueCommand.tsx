// PROJ-036: a workspace made from a linked GitHub issue runs the project's issue command inside the
// new workspace, with the issue filled in. The command is the per-user override in the repository's
// .kolux folder when there is one, else kolux.yaml's shared `issueCommand` (COMPAT 5.6). Rust reads
// both and builds the shell line; this side only asks, and only for an issue (a pull request
// opens its branch and runs nothing).
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { SetupLine } from "../projects/model";
import { askTrust, trusted, type TrustAnswer, type TrustAsk } from "./TrustPrompt";

/** The line that runs the issue command, and whether it came from the shared kolux.yaml (which
 *  needs the repository's trust before it runs, SAFE-025) or from the user's own override. */
export type IssueRun = { line: SetupLine; shared: boolean; command: string };
export type LinkedIssue = { kind?: string; number: number; title: string; url: string };
type Invoke = <T>(cmd: string, args: Record<string, unknown>) => Promise<T>;

/** The terminal title the issue command runs under. */
export const ISSUE_TAB_TITLE = "Issue";

/** Only a linked issue starts the issue command; a pull request or nothing linked does not. */
export function issueToRun(linked: LinkedIssue | null | undefined): LinkedIssue | null {
  return linked && (linked.kind ?? "issue") === "issue" && Number.isInteger(linked.number) && linked.number > 0 ? linked : null;
}

/** PROJ-036: the issue command's line for the workspace at `path` of the repository at `root`, or
 *  null when nothing is linked, the project has no issue command, or the user said Don't run to its
 *  shared one (SAFE-025: asked first, once per command text unless the repository is trusted). */
export async function issueCommand(root: string, path: string, linked: LinkedIssue | null | undefined, invoke: Invoke = tauriInvoke, ask: (a: TrustAsk) => Promise<TrustAnswer> = askTrust): Promise<IssueRun | null> {
  const issue = issueToRun(linked);
  if (!issue) return null;
  if (!(await trusted(path, "issue", { root }, invoke, ask))) return null;
  return invoke<IssueRun | null>("workspace_issue_command", { root, path, number: issue.number, url: issue.url });
}
