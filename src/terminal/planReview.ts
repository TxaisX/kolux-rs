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

/** SAFE-005: at most this many unsent drafts are held in memory. */
export const MAX_DRAFTS = 128;

/** SAFE-005: one draft per pane and per exact plan text, so a revised plan starts empty. */
export const draftKey = (pane: number, plan: string) => `${pane}\n${plan}`;

/** SAFE-005: stores a draft; a held draft keeps its place, and a new one past the limit drops the oldest. */
export function keepDraft(drafts: Record<string, PlanDraft>, key: string, d: PlanDraft): Record<string, PlanDraft> {
  const next = { ...drafts, [key]: d };
  const keys = Object.keys(next);
  return keys.length <= MAX_DRAFTS ? next : Object.fromEntries(keys.slice(-MAX_DRAFTS).map((k) => [k, next[k]]));
}

/** SAFE-007: the sheet's plan can still be answered only while the pane waits on that exact plan. */
export const stillPending = (state: AgentState | undefined, turn: { tool?: string; plan?: string } | undefined, plan: string) =>
  showsReview(state, turn) && turn?.plan === plan;

/** T-032-b: what the Request changes send needs from the window, so it runs and is tested here. */
export type SendSteps = {
  /** The agent's own no to its plan prompt; false when Kolux could not answer it. */
  deny: () => Promise<boolean>;
  /** Whether the pane still sits in its plan-approval ask. */
  asking: () => boolean;
  /** SAFE-004 box 3: when the pane's newest status reading arrived (any number that advances with
   * each reading the pane's status source reports, even one that repeats the same word). A source
   * that never updates leaves this still, which is how a stuck status is told apart from an agent
   * that keeps asking with fresh readings. */
  reads: () => number;
  /** Types the message into the pane as one bracketed paste; false when the write did not reach
   * the pane (stand-in review of lane/marks 243736d, AFTER 11). */
  type: (text: string) => Promise<boolean | void>;
  /** Presses Enter; false when the write did not reach the pane. */
  enter: () => Promise<boolean | void>;
  /** Whether the pane is still open. */
  alive: () => boolean;
  wait: (ms: number) => Promise<void>;
};
/** `write-failed`: the paste (typed false) or the Enter (typed true) did not reach the pane. */
export type SendOutcome = "sent" | "cancelled" | "no-answer" | "still-asking" | "gone" | "write-failed";
/** How the send ended, whether the agent's no went out, and whether the message was typed in. */
export type SendResult = { outcome: SendOutcome; answered: boolean; typed: boolean };
export type PendingSend = { cancel: () => void; done: Promise<SendResult> };

/** SAFE-004 / T-032-b: Request changes as a job. It says no, waits up to 3 seconds (30 steps of
 * 100 ms) for the pane to leave the ask, pastes the message, waits 300 ms and presses Enter only if
 * the pane is not asking again. An Enter while the menu is still open would pick its default, Yes.
 * SAFE-004 box 3: a pane whose status never updates (no new reading through that wait) is a stuck
 * reading, not an open menu, so the feedback goes in anyway at the 3-second mark, text and Enter; a
 * pane that keeps asking while fresh readings keep arriving is really still asking and gets nothing
 * typed, and a pane that had already left the prompt gets the feedback straight away. `cancel` is
 * safe at any point: nothing more goes out after it, and Enter is never pressed once it is called.
 * In the window the no has always gone out before a click can land (the sheet's Cancel shows only
 * after a re-render), and the window marks the pane working once the no is sent, so the wait
 * usually ends at once: a cancel mostly lands while or just after the paste goes in, which leaves
 * the feedback typed but not sent (stand-in review of lane/marks ee2bfbc, FIX-BEFORE 1, FIX-SOON 4). */
export function startFeedback(text: string, s: SendSteps): PendingSend {
  let cancelled = false;
  const run = async (): Promise<SendResult> => {
    let answered = false;
    let typed = false;
    const end = (outcome: SendOutcome): SendResult => ({ outcome, answered, typed });
    await Promise.resolve();
    if (cancelled) return end("cancelled");
    if (!(await s.deny())) return end("no-answer");
    answered = true;
    // SAFE-004 box 3: the status is watched for up to 3 seconds; `reads` says whether a new reading
    // arrived meanwhile, so a source that stopped updating is told apart from one that keeps asking.
    let seen = s.reads();
    let updated = false;
    for (let i = 0; i < 30 && s.asking(); i++) {
      if (cancelled) return end("cancelled");
      await s.wait(100);
      const now = s.reads();
      if (now > seen) {
        updated = true;
        seen = now;
      }
    }
    if (cancelled) return end("cancelled");
    // Still asking with fresh readings: the agent really is still asking. Nothing is typed.
    if (s.asking() && updated) return end("still-asking");
    if (!s.alive()) return end("gone");
    // A paste that did not reach the pane is never followed by Enter, which would send whatever
    // sits in the prompt.
    typed = (await s.type(text)) !== false;
    if (cancelled) return end("cancelled");
    if (!typed) return end("write-failed");
    await s.wait(300);
    if (cancelled) return end("cancelled");
    // A reading that arrived while the paste went in makes the status live again: if it now asks,
    // Enter is held back. A status that was stuck and stayed stuck is the box-3 fallback, which sends.
    if (s.asking() && (updated || s.reads() > seen)) return end("still-asking");
    if (!s.alive()) return end("gone");
    return end((await s.enter()) === false ? "write-failed" : "sent");
  };
  return { cancel: () => void (cancelled = true), done: run() };
}
