// Row 76 (T-226 / VIEW-074 / GIT-025): what the Checks composer knows about the branch's review
// before it offers to start one: a linked pull request (found through the back end's fork /
// renamed-branch fallbacks), none yet, the fork the branch pushes to, or that this provider has no
// lookup. The provider decision is made once, in the back end (scm_pr_find); a lookup that cannot run
// or fails is a note and never blocks starting a pull request.
import { invoke } from "@tauri-apps/api/core";
import { forkNotice, loadPushTarget, type PushTarget } from "./forkPush";
import { needsGitHub, prStateWord, type Pr, type Status } from "./model";

export type ReviewLookup =
  | { kind: "found"; pr: Pr; target: string | null }
  | { kind: "none"; repo: string | null }
  | { kind: "unsupported"; provider: "gitlab" | "other" | "none"; host: string | null }
  | { kind: "failed"; message: string };
export type ReviewFacts = { lookup: ReviewLookup; push: PushTarget | null };

type Answer = { provider?: string; host?: string | null; pr?: Pr | null; repo?: string | null };
type FindArgs = { remoteBranch: string | null; forkOwner: string | null; defaultBranch: string };
export type FindPorts = {
  find: (dir: string, a: FindArgs) => Promise<Answer>;
  pushTarget: (dir: string) => Promise<PushTarget | null>;
};
export const realFindPorts: FindPorts = {
  find: (dir, a) => invoke<Answer>("scm_pr_find", { worktree: dir, ...a, number: null, linked: false }),
  pushTarget: loadPushTarget,
};

/** The `owner/name` a review's address points at (a pull request or a merge request), or null for an address of another shape. */
export const reviewTarget = (url: string): string | null => /^https?:\/\/[^/]+\/(.+?)\/(?:-\/)?(?:pull|merge_requests)\/\d+/.exec(url)?.[1] ?? null;

/** The fork's owner for the lookup, only when the fork is named `owner/name` (a GitHub-style address). */
const ownerOf = (fork: string | null | undefined): string | null => /^([\w.-]+)\/[\w.-]+$/.exec(fork ?? "")?.[1] ?? null;

/** One lookup for this branch. It never throws: a failure is a `failed` answer. */
export async function readReview(dir: string, status: Pick<Status, "branch" | "base">, ports: FindPorts = realFindPorts): Promise<ReviewFacts> {
  if (!status.branch) return { lookup: { kind: "none", repo: null }, push: null };
  const push = await ports.pushTarget(dir).catch(() => null);
  return { lookup: await lookupOf(dir, status, push, ports), push };
}

async function lookupOf(dir: string, status: Pick<Status, "base">, push: PushTarget | null, ports: FindPorts): Promise<ReviewLookup> {
  try {
    const a = await ports.find(dir, { remoteBranch: push?.remoteBranch ?? null, forkOwner: ownerOf(push?.fork), defaultBranch: (status.base ?? "").replace(/^origin\//, "") });
    if (a.provider === "gitlab" || a.provider === "other" || a.provider === "none") return { kind: "unsupported", provider: a.provider, host: a.host ?? null };
    return a.pr ? { kind: "found", pr: a.pr, target: reviewTarget(a.pr.url) } : { kind: "none", repo: a.repo ?? null };
  } catch (err) {
    return { kind: "failed", message: String(err) };
  }
}

/** What the composer says, one line each. `createBlocked`: creating is blocked on this remote too, so the unsupported lookup and the block are said once. */
export function reviewLines(f: ReviewFacts, createBlocked = false): string[] {
  const l = f.lookup;
  const out: string[] = [];
  if (l.kind === "found") {
    out.push(`Pull request #${l.pr.number} (${prStateWord(l.pr)})${l.pr.title ? `: ${l.pr.title}` : ""}`);
    if (l.target) out.push(`Targets ${l.target}`);
  } else if (l.kind === "none") out.push(l.repo ? `No pull request for this branch in ${l.repo}.` : "No pull request found for this branch."); // gh searches origin, which is the fork when the repository was forked; no repo means no location to name
  else if (l.kind === "unsupported") out.push((createBlocked && needsGitHub("Finding or creating", l.provider, l.host)) || `Finding a linked pull request or merge request is not available for ${l.host ?? "this repository"}.`);
  else out.push(`The linked pull request could not be looked up: ${l.message}`);
  const fork = forkNotice(f.push);
  if (fork) out.push(fork);
  return out;
}

/** Answers are kept by worktree and branch; the slot holds only the latest one that was still wanted. */
export type ReviewSlot = { key: string; facts: ReviewFacts } | null;
export const reviewKey = (dir: string, branch: string): string => `${dir}\u0000${branch}`;
/** A late answer for a key that is no longer the current one leaves the slot as it was. */
export const reviewSettle = (slot: ReviewSlot, key: string, facts: ReviewFacts, current: string | null): ReviewSlot => (key === current ? { key, facts } : slot);
export const reviewShown = (slot: ReviewSlot, key: string | null): ReviewFacts | null => (slot && key !== null && slot.key === key ? slot.facts : null);
