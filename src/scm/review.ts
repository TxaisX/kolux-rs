// GIT-029 / GIT-030: the pure parts of the Checks panel's groups and the review comments: grouping,
// the 100-item and 20-annotation caps with their notes, what Fix with AI sends, compact times, and
// how comments are grouped, filtered and cleaned before sending. Rust (pr_review.rs) reads and writes
// GitHub; this file decides what the panel shows.
import type { Check } from "./checks";

export const CHECK_CAP = 100;
export const ANNOTATION_CAP = 20;
export const COMMENT_CAP = 100;
/** Fix with AI sends the end of a failing log: that is where the error is. */
export const FIX_LOG_MAX = 12_000;

export type CheckGroups = { failing: Check[]; pending: Check[]; passing: Check[]; other: Check[] };

/** Failing, pending and passing; a neutral, skipped or cancelled check is never counted as passed. */
export function checkGroups(checks: Check[]): CheckGroups {
  const g: CheckGroups = { failing: [], pending: [], passing: [], other: [] };
  for (const c of checks) {
    if (c.outcome === "failed" || c.outcome === "unresolved") g.failing.push(c);
    else if (c.outcome === "running") g.pending.push(c);
    else if (c.outcome === "passed") g.passing.push(c);
    else g.other.push(c);
  }
  return g;
}

/** The first `cap` items and a note saying how many were left out (null when none). */
export function capped<T>(items: T[], cap: number, what: string): { shown: T[]; note: string | null } {
  if (items.length <= cap) return { shown: items, note: null };
  return { shown: items.slice(0, cap), note: `Showing the first ${cap} of ${items.length} ${what}.` };
}

/** The final part of a log, from a line start, with a note when the start was dropped. */
export function tailOf(log: string, max = FIX_LOG_MAX): string {
  if (log.length <= max) return log;
  const from = log.length - max;
  const cut = log.indexOf("\n", from);
  return `[earlier output left out]\n${log.slice(cut === -1 ? from : cut + 1)}`;
}

export function fixPrompt(check: Check, log: string): string {
  return `The check "${check.name}"${check.workflow ? ` (${check.workflow})` : ""} is failing on this pull request. Find the cause in this repository and fix it. Here is the end of its output:\n\n${tailOf(log)}`;
}

/** 3m, 2h, 5d, 3w, 4mo, 2y; "now" under a minute; invalid or missing input shows nothing. */
export function relativeTime(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return "now";
  const steps: [number, string][] = [[60, "m"], [3600, "h"], [86400, "d"], [604800, "w"], [2592000, "mo"], [31536000, "y"]];
  for (let i = steps.length - 1; i >= 0; i--) if (s >= steps[i][0]) return `${Math.floor(s / steps[i][0])}${steps[i][1]}`;
  return "now";
}

export type Reaction = { content: string; count: number; mine: boolean };
export type Comment = { id: string; db_id: number | null; author: string; bot: boolean; body: string; at: string; reactions?: Reaction[] };
export type Thread = { id: string; path: string | null; line: number | null; resolved: boolean; comments: Comment[]; more: number };
export type Review = { threads: Thread[]; talk: Comment[]; talk_more: number };

export type Row = { kind: "file"; path: string; threads: Thread[] } | { kind: "talk"; comment: Comment };

/** Hides bot comments (and threads made only of them) when asked. */
export function visibleReview(r: Review, hideBots: boolean): Review {
  if (!hideBots) return r;
  return {
    ...r,
    talk: r.talk.filter((c) => !c.bot),
    threads: r.threads.map((t) => ({ ...t, comments: t.comments.filter((c) => !c.bot) })).filter((t) => t.comments.length > 0),
  };
}

/** By file: threads under their file, the plain conversation after. */
export function byFile(r: Review): Row[] {
  const files = new Map<string, Thread[]>();
  for (const t of r.threads) files.set(t.path ?? "", [...(files.get(t.path ?? "") ?? []), t]);
  const rows: Row[] = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, threads]) => ({ kind: "file", path, threads }));
  return [...rows, ...r.talk.map((comment): Row => ({ kind: "talk", comment }))];
}

/** As a timeline: every comment, oldest first, each with the file it belongs to. */
export function timeline(r: Review): { comment: Comment; path: string | null }[] {
  const all = [...r.talk.map((comment) => ({ comment, path: null as string | null })), ...r.threads.flatMap((t) => t.comments.map((comment) => ({ comment, path: t.path })))];
  return all.sort((a, b) => Date.parse(a.comment.at) - Date.parse(b.comment.at));
}

/** A comment goes out trimmed; a blank one does not go out at all. */
export function cleanComment(text: string): string | null {
  const t = text.trim();
  return t === "" ? null : t;
}

/** The note for threads or conversations longer than the 100 comments read. */
export function moreNote(n: number): string | null {
  return n > 0 ? `${n} more comment${n === 1 ? "" : "s"} not shown; open the pull request on GitHub to read them.` : null;
}

// ---- VIEW-075: the comments as cards ---------------------------------------------------------------

/** The reactions GitHub offers, by the name the REST call takes. */
export const REACTION_CHOICES: { content: string; emoji: string; label: string }[] = [
  { content: "+1", emoji: "👍", label: "Thumbs up" },
  { content: "-1", emoji: "👎", label: "Thumbs down" },
  { content: "laugh", emoji: "😄", label: "Laugh" },
  { content: "hooray", emoji: "🎉", label: "Hooray" },
  { content: "confused", emoji: "😕", label: "Confused" },
  { content: "heart", emoji: "❤️", label: "Heart" },
  { content: "rocket", emoji: "🚀", label: "Rocket" },
  { content: "eyes", emoji: "👀", label: "Eyes" },
];

export const emojiOf = (content: string): string => REACTION_CHOICES.find((r) => r.content === content)?.emoji ?? content;

export type CardGroups = { open: Thread[]; conversation: Comment[]; resolved: Thread[] };

/** Open threads, the plain conversation and resolved threads, each oldest first. */
export function cardGroups(r: Review): CardGroups {
  const first = (t: Thread) => Date.parse(t.comments[0]?.at ?? "") || 0;
  const byAge = (a: Thread, b: Thread) => first(a) - first(b);
  return {
    open: r.threads.filter((t) => !t.resolved).sort(byAge),
    conversation: [...r.talk].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
    resolved: r.threads.filter((t) => t.resolved).sort(byAge),
  };
}

/** How many cards the comments make: threads plus conversation comments. */
export const cardCount = (r: Review): number => r.threads.length + r.talk.length;

/** Enter sends, Shift+Enter makes a new line, and Enter while an input method is composing does neither. */
export function sendsOnEnter(e: { key: string; shiftKey: boolean; isComposing?: boolean; keyCode?: number }): boolean {
  if (e.key !== "Enter" || e.shiftKey) return false;
  return !(e.isComposing === true || e.keyCode === 229);
}

/** The settings key of author names the user marked as bots. */
export const REVIEW_BOTS_KEY = "reviewBots";
export const botNames = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** The REST kind a reaction goes by: review comments and conversation comments use different calls. */
export const reactKind = (inThread: boolean): "react" | "react_talk" => (inThread ? "react" : "react_talk");

/** What a card says about its place: the file and line of a thread, nothing for the conversation. */
export const placeOf = (t: Pick<Thread, "path" | "line">): string => (t.path ? (t.line ? `${t.path}:${t.line}` : t.path) : "");
