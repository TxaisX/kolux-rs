// SAFE-001..004: reviewing the plan Claude asks to leave plan mode with. The plan is split into
// sections that each take comments; Request changes turns them into one message for Claude.
import type { AgentState } from "../projects/rows";

export type Section = { start: number; end: number; text: string };
export type PlanComment = { id: string; start: number; end: number; quote: string; text: string };
export type PlanDraft = { comments: PlanComment[]; note: string };

/** SAFE-002: a blank line starts a new section, except inside a fenced code block; lines count from 1. */
export function planSections(plan: string): Section[] {
  const out: Section[] = [];
  let cur: string[] = [];
  let start = 0;
  let fence: string | null = null;
  const flush = () => {
    if (cur.length > 0) out.push({ start, end: start + cur.length - 1, text: cur.join("\n") });
    cur = [];
  };
  plan.split(/\r?\n/).forEach((line, i) => {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (mark) {
      if (fence === null) fence = mark;
      else if (mark[0] === fence[0] && mark.length >= fence.length) fence = null;
    }
    if (line.trim() === "" && fence === null) return flush();
    if (cur.length === 0) start = i + 1;
    cur.push(line);
  });
  flush();
  return out;
}

/** A short one-line quote of a section, for its comments. */
export function sectionQuote(text: string): string {
  const one = text.split(/\s+/).filter(Boolean).join(" ");
  return one.length <= 60 ? one : `${one.slice(0, 59)}…`;
}

export const OPENING = "Please revise the plan with my feedback below, then show me the revised plan.";

/** SAFE-004: there is something to send once a comment exists or the note is more than whitespace. */
export const canRequest = (comments: PlanComment[], note: string) => comments.length > 0 || note.trim() !== "";

/** SAFE-004: the opening line, each comment by line range with a quote, then the overall note. */
export function feedbackMessage(comments: PlanComment[], note: string): string {
  const parts = [OPENING, ...comments.map((c) => `${c.start === c.end ? `Line ${c.start}` : `Lines ${c.start}-${c.end}`}:\n> ${c.quote}\n${c.text.trim()}`)];
  if (note.trim()) parts.push(`Overall: ${note.trim()}`);
  return parts.join("\n\n");
}

/** SAFE-001: the review button is up only while Claude waits on its exit-plan step and sent the plan. */
export const showsReview = (state: AgentState | undefined, turn: { tool?: string; plan?: string } | undefined) =>
  (state === "waiting" || state === "permission") && turn?.tool === "ExitPlanMode" && !!turn.plan?.trim();
