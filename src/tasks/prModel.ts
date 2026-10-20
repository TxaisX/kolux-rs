// GIT-051 (T-232-c): the pure parts of the full pull request page: what a pasted GitHub address
// means, how checks and review states read, which workflow runs a "rerun" touches, who can be
// suggested as a reviewer, and what the merge box allows.
import { requestReviewers } from "./people";
import type { Person } from "./repoFacts";

export type PrReviewer = { login: string; state: string };
export type PrCheck = { id: number; name: string; status: string; conclusion: string; url: string; runId: number | null };
export type PrPageData = { number: number; title: string; body: string; state: string; draft: boolean; url: string; author: string; headRef: string; headSha: string; baseRef: string; mergeableState: string; labels: { name: string; color: string }[]; assignees: string[]; reviewers: PrReviewer[]; reactions: { content: string; count: number }[]; additions: number; deletions: number; changedFiles: number; reviewsTruncated: boolean; reviewsLimit: number };
/** `limit`: how many items the backend reads at most; `truncated` says there were more. */
export type DiffLimits = { lines: number; chars: number; budget: number };
export type PrFiles = { files: PrFile[]; truncated: boolean; limit: number; diffLimits: DiffLimits };
export type PrThreads = { threads: PrThread[]; truncated: boolean; limit: number };
/** `held`: why `patch` was left empty (over the line or size limit, or past the budget of one read); `patchLines` and `patchChars` are the full diff's size. */
export type PrFile = { filename: string; status: string; additions: number; deletions: number; patch: string; held?: "lines" | "size" | "budget" | null; patchLines?: number; patchChars?: number };
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
    if (failedOnly && !checks.some((x) => x.runId === c.runId && x.status === "completed" && ["failure", "timed_out", "cancelled", "action_required"].includes(x.conclusion))) continue;
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
  if (!["clean", "has_hooks", "unstable"].includes(p.mergeableState)) return { canMerge: false, reason: "GitHub is still checking whether it can merge." };
  return { canMerge: true, reason: p.mergeableState === "unstable" ? "Some checks are not passing." : "Ready to merge." };
}

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

/** GIT-039 (T-176-d): how a held-back file diff is worded; the numbers come from the backend (`diffLimits`), never from here. */
export function sizeWords(chars: number): string {
  if (chars >= 1024 * 1024) return `${(chars / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(chars / 1024))} KB`;
}

/** Why a file's diff was not sent, with the limit that held it; null when it was sent. */
export function heldWords(f: Pick<PrFile, "held" | "patchLines" | "patchChars">, limits: DiffLimits): string | null {
  const lines = f.patchLines ?? 0;
  const chars = f.patchChars ?? 0;
  switch (f.held) {
    case "lines":
      return `Held back: this diff is ${lines.toLocaleString("en-US")} lines, over the limit of ${limits.lines.toLocaleString("en-US")} lines.`;
    case "size":
      return `Held back: this diff is ${sizeWords(chars)}, over the limit of ${sizeWords(limits.chars)}.`;
    case "budget":
      return `Held back: the diffs of this pull request are over the ${sizeWords(limits.budget)} Kolux sends at once, so this one (${sizeWords(chars)}) waits until you load it.`;
    default:
      return null;
  }
}
