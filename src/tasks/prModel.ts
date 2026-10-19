// GIT-051 (T-232-c): the pure parts of the full pull request page: what a pasted GitHub address
// means, how checks and review states read, which workflow runs a "rerun" touches, who can be
// suggested as a reviewer, and what the merge box allows.
import { requestReviewers } from "./people";
import type { Person } from "./repoFacts";

export type PrReviewer = { login: string; state: string };
export type PrCheck = { id: number; name: string; status: string; conclusion: string; url: string; runId: number | null };
export type PrPageData = { number: number; title: string; body: string; state: string; draft: boolean; url: string; author: string; headRef: string; headSha: string; baseRef: string; mergeableState: string; labels: { name: string; color: string }[]; assignees: string[]; reviewers: PrReviewer[]; reactions: { content: string; count: number }[]; additions: number; deletions: number; changedFiles: number; reviewsTruncated: boolean };
export type PrFiles = { files: PrFile[]; truncated: boolean };
export type PrThreads = { threads: PrThread[]; truncated: boolean };
export type PrFile ={ filename: string; status: string; additions: number; deletions: number; patch: string };
export type PrComment = { id: number; author: string; body: string; at: string };
export type PrThread = { id: number; path: string; line: number | null; comments: PrComment[] };

export type Target = { host: string; repo: string; number: number; kind: "pull" | "issue" };

/** A pasted GitHub address (`https://<host>/owner/name/pull/12`, issues too) as the place it names;
 * anything else (other paths, other schemes, odd names) is null. The host is checked again in Rust. */
export function parseGitHubUrl(text: string): Target | null {
  let u: URL;
  try {
    u = new URL(text.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const m = /^\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/(pull|issues)\/(\d+)\/?(?:files|commits|checks)?\/?$/.exec(u.pathname);
  if (!m || m[1] === "." || m[1] === ".." || m[2] === "." || m[2] === "..") return null;
  const number = Number(m[4]);
  if (!(number > 0)) return null;
  return { host: u.host.toLowerCase(), repo: `${m[1]}/${m[2]}`, number, kind: m[3] === "pull" ? "pull" : "issue" };
}

export type ChecksSummary = { passed: number; failed: number; running: number; other: number; label: string; tone: "ok" | "bad" | "wait" | "none" };

export function summarizeChecks(checks: PrCheck[]): ChecksSummary {
  let passed = 0;
  let failed = 0;
  let running = 0;
  let other = 0;
  for (const c of checks) {
    if (c.status !== "completed") running++;
    else if (c.conclusion === "success") passed++;
    else if (["failure", "timed_out", "cancelled", "action_required"].includes(c.conclusion)) failed++;
    else other++;
  }
  if (!checks.length) return { passed, failed, running, other, label: "No checks", tone: "none" };
  if (failed) return { passed, failed, running, other, label: `${failed} failing, ${passed} passing`, tone: "bad" };
  if (running) return { passed, failed, running, other, label: `${running} running, ${passed} passing`, tone: "wait" };
  return { passed, failed, running, other, label: `${passed + other} of ${checks.length} passing`, tone: "ok" };
}

/** The workflow runs a rerun touches: every run, or only those with a failing job; each once. */
export function rerunTargets(checks: PrCheck[], failedOnly: boolean): number[] {
  const runs: number[] = [];
  for (const c of checks) {
    if (c.runId === null || runs.includes(c.runId)) continue;
    if (failedOnly && !checks.some((x) => x.runId === c.runId && x.status === "completed" && ["failure", "timed_out", "cancelled"].includes(x.conclusion))) continue;
    runs.push(c.runId);
  }
  return runs;
}

export const REVIEW_LABEL: Record<string, string> = { requested: "Review requested", approved: "Approved", changes_requested: "Changes requested", dismissed: "Review dismissed", commented: "Commented" };

/** People to suggest when asking for a review: not the author, not already on the pull request
 * (requested or reviewed), matching what was typed; a person who commented before comes first. */
export function reviewerSuggestions(people: Person[], page: Pick<PrPageData, "author" | "reviewers">, typed: string, limit = 8): Person[] {
  const q = typed.trim().replace(/^@/, "").toLowerCase();
  const taken = new Set([page.author.toLowerCase(), ...page.reviewers.filter((r) => r.state !== "dismissed").map((r) => r.login.toLowerCase())]);
  return people.filter((p) => !taken.has(p.login.toLowerCase()) && p.login.toLowerCase().includes(q)).slice(0, limit);
}

/** Asking `logins` for a review: the list to send, or why not (the sixteenth requested reviewer is refused). */
export function askForReview(page: Pick<PrPageData, "reviewers">, logins: string[]) {
  return requestReviewers(
    page.reviewers.filter((r) => r.state === "requested").map((r) => r.login),
    logins,
  );
}

export type MergeBox = { canMerge: boolean; reason: string };

/** What the merge box says: draft, closed, merged and blocked pull requests cannot be merged from
 * here, nor one in a repository that is not added in Kolux (`added`, true unless told otherwise), nor
 * one GitHub has not finished checking (its state reads unknown or empty for a moment after a push). */
export function mergeBox(p: Pick<PrPageData, "state" | "draft" | "mergeableState">, added = true): MergeBox {
  if (p.state === "merged") return { canMerge: false, reason: "Already merged." };
  if (p.state !== "open") return { canMerge: false, reason: "Closed; reopen it to merge." };
  if (p.draft) return { canMerge: false, reason: "A draft; mark it ready on GitHub to merge." };
  if (!added) return { canMerge: false, reason: "Add this repository in Kolux to merge from here." };
  if (p.mergeableState === "dirty") return { canMerge: false, reason: "Has conflicts with the base branch." };
  if (p.mergeableState === "blocked") return { canMerge: false, reason: "Blocked: GitHub is waiting for reviews or checks." };
  if (p.mergeableState === "behind") return { canMerge: false, reason: "Behind the base branch; update it first." };
  if (!["clean", "has_hooks", "unstable"].includes(p.mergeableState)) return { canMerge: false, reason: "GitHub is still checking whether it can merge" };
  return { canMerge: true, reason: p.mergeableState === "unstable" ? "Some checks are not passing." : "Ready to merge." };
}

/** Files, reviews and review comments are read 100 at a time up to this many; past it the page says so. */
export const PAGE_LIMIT = 500;

export const MERGE_METHODS: { id: "merge" | "squash" | "rebase"; label: string }[] = [
  { id: "merge", label: "Create a merge commit" },
  { id: "squash", label: "Squash and merge" },
  { id: "rebase", label: "Rebase and merge" },
];

export const REACTION_EMOJI: Record<string, string> = { "+1": "👍", "-1": "👎", laugh: "😄", confused: "😕", heart: "❤️", hooray: "🎉", rocket: "🚀", eyes: "👀" };

const TAB_KEY = "kolux.prTab.";
export type PrTab = "conversation" | "checks" | "files";

/** The tab last open on this pull request (kept between visits), else the conversation. */
export function savedTab(store: Pick<Storage, "getItem">, t: Pick<Target, "host" | "repo" | "number">): PrTab {
  try {
    const v = store.getItem(`${TAB_KEY}${t.host}/${t.repo}#${t.number}`);
    return v === "checks" || v === "files" ? v : "conversation";
  } catch {
    return "conversation";
  }
}

export function saveTab(store: Pick<Storage, "setItem">, t: Pick<Target, "host" | "repo" | "number">, tab: PrTab) {
  try {
    store.setItem(`${TAB_KEY}${t.host}/${t.repo}#${t.number}`, tab);
  } catch {
    /* a private window keeps nothing; the next visit opens on the conversation */
  }
}
