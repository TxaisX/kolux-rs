// VIEW-043: pull requests in the palette. The rows come from what the background poll found (number,
// title, state) and from the Checks panel's own answers (the checks), kept in one small store so the
// palette never asks a different question than the panel. A workspace whose pull request the host
// reports as gone (an answer with no pull request and no error) loses its row at once: an older
// cached result is never listed in its place. A failed lookup keeps what was known, as the poll does.
import type { PaletteItem } from "../projects/WorktreePalette";
import type { Check, PrChecks } from "./checks";
import { prStateWord, type Pr } from "./model";
import type { PrPoll } from "./poll";

export type Known = { path: string; linked: boolean; pr: Pr; checks: Check[] | null; at: number | null };
export type KnownPrs = Record<string, Known>;

const sameCall = (a: Pr, b: Pr) => a.number === b.number && a.url.toLowerCase() === b.url.toLowerCase();

/** A poll round over what was known: a found pull request replaces the row (its checks stay only for
 * the same pull request), no pull request without an error removes it, an error keeps the old row. */
export function applyPoll(prev: KnownPrs, poll: PrPoll): KnownPrs {
  const next = { ...prev };
  for (const p of poll.prs) {
    if (p.error !== null) continue;
    if (!p.pr) {
      delete next[p.path];
      continue;
    }
    const old = next[p.path];
    const keep = old && sameCall(old.pr, p.pr);
    next[p.path] = { path: p.path, linked: p.linked, pr: keep ? { ...old.pr, ...p.pr } : p.pr, checks: keep ? old.checks : null, at: keep ? old.at : null };
  }
  return next;
}

/** The Checks panel's answer for a workspace. No pull request there removes the row; a different
 * pull request than the one known replaces it, so a row never mixes one PR's title with another's checks. */
export function applyChecks(prev: KnownPrs, path: string, data: PrChecks, now: number): KnownPrs {
  const next = { ...prev };
  if (!data.pr) {
    delete next[path];
    return next;
  }
  next[path] = { path, linked: prev[path]?.linked ?? false, pr: prev[path] && sameCall(prev[path].pr, data.pr) ? { ...prev[path].pr, ...data.pr } : data.pr, checks: data.checks, at: now };
  return next;
}

const COUNT_ORDER: Check["outcome"][] = ["failed", "unresolved", "running", "cancelled", "skipped", "neutral", "passed"];

/** The check state as the row says it: counts by outcome, "no checks", or not read yet. */
export function checkLine(checks: Check[] | null): string {
  if (checks === null) return "checks not read yet";
  if (checks.length === 0) return "no checks";
  return COUNT_ORDER.map((o) => [o, checks.filter((c) => c.outcome === o).length] as const)
    .filter(([, n]) => n > 0)
    .map(([o, n]) => `${n} ${o}`)
    .join(" · ");
}

/** The palette's pull request rows: label "#number title" so a number or a title word finds it. */
export function prItems(known: KnownPrs, go: (path: string) => void): PaletteItem[] {
  return Object.values(known).map((k) => ({
    section: "Pull requests",
    label: `#${k.pr.number} ${k.pr.title?.trim() || k.pr.head || "Pull request"}`,
    hint: `${prStateWord(k.pr)} · ${checkLine(k.checks)}`,
    dir: k.path,
    number: k.pr.number,
    run: () => go(k.path),
  }));
}

/** The open pull requests whose checks have not been read, or were read too long ago, newest poll order. */
export function needChecks(known: KnownPrs, now: number, staleMs: number, max: number): Known[] {
  return Object.values(known)
    .filter((k) => k.pr.state === "OPEN" && (k.at === null || now - k.at > staleMs))
    .slice(0, max);
}

// ---- the store ---------------------------------------------------------------------------------

let snapshot: KnownPrs = {};
const listeners = new Set<() => void>();
const set = (next: KnownPrs) => {
  snapshot = next;
  listeners.forEach((l) => l());
};

export const getKnown = (): KnownPrs => snapshot;
export const subscribeKnown = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
/** Called by the poller after each round. */
export const recordPoll = (poll: PrPoll): void => set(applyPoll(snapshot, poll));
/** Called by the Checks panel after each answer. */
export const recordChecks = (path: string, data: PrChecks): void => set(applyChecks(snapshot, path, data, Date.now()));
/** Tests only. */
export const resetKnown = (): void => set({});
