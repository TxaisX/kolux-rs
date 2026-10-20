// GIT-059 (T-232-d): what a paste into Tasks' address box means. A GitHub issue or pull request address
// (or a number after a hash sign) is an item lookup that starts or resumes work on exactly that item;
// an ordinary word or sentence is not, and oversized text is refused. Pure and tested on its own.
import type { Task } from "./model";
import { parseGitHubUrl, type Target } from "./prModel";
import type { WorkItem } from "./workStart";
import { workItem } from "./workStart";

/** The most text one paste into the address box may hold; more is refused, never looked up. */
export const PASTE_MAX = 2000;

export type Pasted =
  | { kind: "item"; target: Target }
  | { kind: "number"; number: number }
  | { kind: "refused"; reason: string }
  | null;

/** `null`: ordinary text, no lookup happens. An address names its own host and repository, so a cached
 * row with a similar number is never picked for it. */
export function pastedWork(text: string): Pasted {
  const t = text.trim();
  if (!t) return null;
  if (text.length > PASTE_MAX) return { kind: "refused", reason: `That paste is longer than ${PASTE_MAX} characters, so no item was looked up. Paste only the address.` };
  const target = parseGitHubUrl(t);
  if (target) return { kind: "item", target };
  const m = /^#(\d{1,9})$/.exec(t);
  if (m && Number(m[1]) > 0) return { kind: "number", number: Number(m[1]) };
  return null;
}

/** The row a task list already holds for `#number` else null: a number
 * is only ever looked up among the items on screen, never guessed across repositories. */
export function rowForNumber<T extends Pick<Task, "number">>(items: T[], number: number): T | null {
  const hits = items.filter((t) => t.number === number);
  return hits.length === 1 ? hits[0] : null;
}

/** The item the create command takes for a pasted address, or null when its repository name is odd. */
export function itemOfTarget(t: Target): WorkItem | null {
  return workItem({ kind: t.kind === "issue" ? "issue" : "pr", number: t.number, repo: t.repo, host: t.host }, t.host);
}

/** What the strip under the box says while it reads the item's title, and once it has it. */
export function pasteLine(t: Target, title: string | null): string {
  const what = t.kind === "issue" ? "Issue" : "Pull request";
  return title ? `${what} #${t.number} in ${t.repo}: ${title}` : `${what} #${t.number} in ${t.repo}`;
}
