// GIT-049 (T-231-e): starting or resuming a workspace from an issue or pull request in Tasks. A
// workspace that already belongs to the item is resumed (it is selected, not made twice); the
// rest is made by the existing create command from the item's address. Pure helpers only.
import type { Worktree } from "../projects/model";
import type { Task } from "./model";

/** The item as the create command takes it (host, owner, repository, kind, number). */
export type WorkItem = { host: string; owner: string; repo: string; kind: "pull" | "issue"; number: number };

/** The item in a task row, or null when its repository name is not owner/name. The row's own host
 * wins; `host` (the first chosen repository's) is only for a row that has none. */
export function workItem(task: Pick<Task, "kind" | "number" | "repo" | "host">, fallbackHost: string): WorkItem | null {
  const host = task.host ?? fallbackHost;
  const [owner, repo, extra] = task.repo.split("/");
  if (!owner || !repo || extra !== undefined || !task.number) return null;
  return { host, owner, repo, kind: task.kind === "issue" ? "issue" : "pull", number: task.number };
}

/** The workspace already made for this item among a project's worktrees: the one linked to its
 * number, never the main checkout. */
export function existingWorkspace(worktrees: Pick<Worktree, "path" | "isMain" | "number">[], number: number): string | null {
  return worktrees.find((w) => !w.isMain && w.number === number)?.path ?? null;
}

/** What the item's button offers: resume when a workspace exists, else start. */
export const workLabel = (existing: string | null, task: Pick<Task, "kind">): string => (existing ? "Resume workspace" : task.kind === "issue" ? "Start workspace" : "Check out in a workspace");

/** Which repository a workspace list belongs to: host and owner/name, without case. The same name on
 * two hosts is two repositories, so a row never resumes the other host's workspace (review AFTER 5). */
export const linkKey = (host: string, repo: string): string => `${host}/${repo}`.toLowerCase();
