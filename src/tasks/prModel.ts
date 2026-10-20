// GIT-051 (T-232-c): the pure parts of the full pull request page: what a pasted GitHub address
// means, how checks and review states read, which workflow runs a "rerun" touches, who can be
// suggested as a reviewer, and what the merge box allows.
import { requestReviewers } from "./people";
import { fixPrompt } from "../scm/review";
import type { Person } from "./repoFacts";

export type PrReviewer = { login: string; state: string };
export type PrCheck = { id: number; name: string; status: string; conclusion: string; url: string; runId: number | null };
export type PrPageData = { number: number; title: string; body: string; state: string; draft: boolean; url: string; author: string; headRef: string; headSha: string; baseRef: string; headRepo?: string; mergeableState: string; labels: { name: string; color: string }[]; assignees: string[]; reviewers: PrReviewer[]; reactions: { content: string; count: number }[]; additions: number; deletions: number; changedFiles: number; reviewsTruncated: boolean; reviewsLimit: number };
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
 * (requested or reviewed), matching what was typed. GIT-053: recent editors of the changed files come
 * first (even when the people list does not hold them), then a person who commented before. */
export function reviewerSuggestions(people: Person[], page: Pick<PrPageData, "author" | "reviewers">, typed: string, limit = 8, editors: string[] = []): Person[] {
  const q = typed.trim().replace(/^@/, "").toLowerCase();
  const taken = new Set([page.author.toLowerCase(), ...page.reviewers.filter((r) => r.state !== "dismissed").map((r) => r.login.toLowerCase())]);
  const seen = new Set<string>();
  const out: Person[] = [];
  const known = new Map(people.map((p) => [p.login.toLowerCase(), p]));
  for (const login of editors) known.has(login.toLowerCase()) || known.set(login.toLowerCase(), { login, avatar: "" });
  for (const p of [...editors.map((e) => known.get(e.toLowerCase())!), ...people]) {
    const k = p.login.toLowerCase();
    if (taken.has(k) || seen.has(k) || !k.includes(q)) continue;
    seen.add(k);
    out.push(p);
  }
  return out.slice(0, limit);
}

/** GIT-053: whether a suggested login came from the recent editors of the changed files. */
export function isEditor(editors: string[], login: string): boolean {
  return editors.some((e) => e.toLowerCase() === login.toLowerCase());
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

// ---- T-232-d ----

/** GIT-052: GitHub's viewed mark for a changed file; "dismissed" is a file changed since it was viewed. */
export type ViewedState = "viewed" | "unviewed" | "dismissed";
export type PrViewed = { files: { path: string; state: ViewedState }[]; truncated: boolean; limit: number };

/** The state of `path`; a file the answer does not hold (a cut list) is unviewed. */
export function viewedOf(v: PrViewed | null, path: string): ViewedState {
  return v?.files.find((f) => f.path === path)?.state ?? "unviewed";
}

/** The list with `path` marked (or unmarked), before GitHub has answered; an unlisted path is added. */
export function withViewed(v: PrViewed, path: string, on: boolean): PrViewed {
  const state: ViewedState = on ? "viewed" : "unviewed";
  const files = v.files.some((f) => f.path === path) ? v.files.map((f) => (f.path === path ? { ...f, state } : f)) : [...v.files, { path, state }];
  return { ...v, files };
}

/** "3 of 12 files viewed", with how many changed since being viewed; nothing when no list is read. */
export function viewedLine(files: Pick<PrFile, "filename">[], v: PrViewed | null): string {
  if (!v || files.length === 0) return "";
  const done = files.filter((f) => viewedOf(v, f.filename) === "viewed").length;
  const changed = files.filter((f) => viewedOf(v, f.filename) === "dismissed").length;
  return `${done} of ${files.length} files viewed${changed ? `, ${changed} changed since viewed` : ""}`;
}

const FAILING = ["failure", "timed_out", "cancelled", "action_required"];
/** The finished checks that did not pass. */
export function failedChecks(checks: PrCheck[]): PrCheck[] {
  return checks.filter((c) => c.status === "completed" && FAILING.includes(c.conclusion));
}

/** GIT-051: why "Fix with AI" is off for a check, or null when it can go: only a failed check with a
 * workflow run to read, and only with a workspace to send the prompt to. */
export function fixBlocker(c: PrCheck, workspace: string | null): string | null {
  if (!failedChecks([c]).length) return "Only a failed check can be fixed.";
  if (c.runId === null || !c.url.includes("/actions/runs/")) return "This check has no workflow run to read.";
  if (!workspace) return "Start a workspace for this pull request first, then its agent can fix the check.";
  return null;
}

/** The prompt sent to the workspace's agent: the same words as the Git panel's Fix with AI. */
export function fixText(c: PrCheck, log: string): string {
  return fixPrompt({ name: c.name, outcome: "failed", link: c.url }, log);
}

/** The branch's repository as the head line shows it: `owner:branch` when it is another repository
 * than the one the pull request is in (a fork), else just the branch. */
export function headLabel(repo: string, p: Pick<PrPageData, "headRef" | "headRepo">): string {
  const from = (p.headRepo ?? "").trim();
  if (!from) return p.headRef;
  return from.toLowerCase() === repo.toLowerCase() ? p.headRef : `${from.split("/")[0]}:${p.headRef}`;
}

/** GIT-060: the note for a fork: `fork of up/stream`, `null` for a plain repository. */
export function lineageNote(l: { fork: boolean; parent?: string | null; parentOwner?: string | null } | null): string | null {
  if (!l?.fork) return null;
  return l.parent ? `Fork of ${l.parent}` : "Fork (its parent is gone)";
}

/** GIT-051: the label names a repository offers that the pull request does not carry yet. */
export function labelsToAdd(offer: { name: string }[], have: { name: string }[]): string[] {
  const taken = new Set(have.map((l) => l.name.toLowerCase()));
  return offer.map((l) => l.name).filter((n) => !taken.has(n.toLowerCase()));
}
