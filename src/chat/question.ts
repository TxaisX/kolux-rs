// Native chat, the question card (CHAT-022; T-327-b). When the agent asks the user a multiple-choice question
// (Claude's AskUserQuestion, Codex's request_user_input) the transcript holds the call with its questions and
// options, and the hook says the agent is waiting. The card shows them; the answer is typed into the agent's
// terminal as the keys that choose the option numbers, one step at a time, and the rest of the keys are dropped
// when the pane changes, sending becomes impossible or another question takes the first one's place.
//
// Keys (PROVENANCE: no public page lists the menu's keys; these are the numbers the menu itself prints beside its
// options, which the card repeats; live proof pending): an option is its number, 1 from the top; "Other" is the
// number after the last option and opens a text field, so the typed answer follows and Enter ends it; a question
// that allows several picks gets Enter after its numbers; several questions end with Enter on the review screen;
// Skip moves on to the next question with the right arrow.
import type { ChatItem } from "./model";
import type { Question } from "./steps";
import { ENTER_PAUSE_MS, enqueue, harmless, typeSteps, type Step } from "./composer";

/** The card for the newest question. `id` is the call's id (what the transcript's result will name). */
export type QuestionCard = { id: string; sig: string; questions: Question[] };

/** What the user chose for one question: option indexes (from 0), a typed answer, or a skip. */
export type Pick = { chosen: number[]; text: string; skipped?: boolean };

/** The question card's identity apart from the call id: the same questions asked again are the same card. */
export const sigOf = (questions: readonly Question[]) => questions.map((q) => q.question).join("\n");

const closed = new Set<string>();
/** The card was answered or dismissed: the same question stays hidden, even when the agent asks it again. */
export const closeQuestion = (sig: string) => void closed.add(sig);
export const questionClosed = (sig: string) => closed.has(sig);
/** For tests. */
export const forgetQuestions = () => closed.clear();

/** The card to draw, or null. It is the newest ask-the-user call that has no result yet, while the hook says the
 * agent waits (`waiting`; undefined when the window has no hook reading, then the transcript alone decides), and
 * nothing came after it: a message the user typed, an interrupt or a result means it is over (this also covers /clear,
 * which leaves a command row). A closed question stays hidden. */
export function openQuestion(items: readonly ChatItem[], waiting: boolean | undefined): QuestionCard | null {
  if (waiting === false) return null;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.role === "user" || it.kind === "interrupted") return null;
    const qs = it.tool?.questions;
    if (!qs) continue;
    if (it.tool?.done || qs.length === 0) return null;
    const sig = sigOf(qs);
    return questionClosed(sig) ? null : { id: it.tool?.call ?? it.id, sig, questions: qs };
  }
  return null;
}

/** The digit key for option number `n` (1 from the top), or null past 9, where one key no longer names it. */
const digit = (n: number) => (n >= 1 && n <= 9 ? String(n) : null);

/** The keys that answer every question, in order, as terminal steps. Empty when something cannot be typed (an option
 * past number 9, or nothing chosen anywhere): the card then asks the user to answer in the terminal. */
export function answerSteps(questions: readonly Question[], picks: readonly Pick[]): Step[] {
  const none = questions.every((_, i) => !picks[i] || picks[i].skipped || (!picks[i].text.trim() && picks[i].chosen.length === 0));
  if (none) return [];
  const out: Step[] = [];
  const key = (data: string, waitMs = 80) => out.push({ data, waitMs });
  for (const [i, q] of questions.entries()) {
    const p = picks[i] ?? { chosen: [], text: "" };
    const text = harmless(p.text).replace(/\r?\n+/g, " ").trim();
    if (p.skipped || (!text && p.chosen.length === 0)) {
      key("\x1b[C");
      continue;
    }
    if (text) {
      const other = digit(q.options.length + 1);
      if (!other) return [];
      key(other, 150);
      key(text, ENTER_PAUSE_MS);
      key("\r", 150);
      continue;
    }
    const keys = [...p.chosen].sort((a, b) => a - b).map((n) => digit(n + 1));
    if (keys.some((k) => k === null)) return [];
    for (const k of keys) key(k as string);
    if (q.multi) key("\r", 150);
  }
  if (questions.length > 1) key("\r", 0);
  return out;
}

export type QuestionDeps = {
  terminalOf: (key: number) => number | undefined;
  stateOf?: (key: number) => string | undefined;
  write: (terminal: number, data: string) => Promise<unknown>;
  /** The card showing for the pane right now (its id), read live. */
  current: (key: number) => string | undefined;
  sleep?: (ms: number) => Promise<unknown>;
};
/** The answer went in, was stopped part way (the rest of the keys dropped), or the pane has no terminal. */
export type QuestionOutcome = "sent" | "stopped" | "no-terminal";

/** Types `steps` into the pane's terminal behind any earlier writes to it. `cancel()` drops the keys not yet typed. The
 * keys are dropped too when the pane's terminal changes, the hook stops saying "waiting", or another card takes this one's place. */
export function sendAnswer(key: number, card: QuestionCard, steps: Step[], deps: QuestionDeps): { done: Promise<QuestionOutcome>; cancel: () => void } {
  let cancelled = false;
  const terminal = deps.terminalOf(key);
  if (terminal === undefined) return { done: Promise.resolve("no-terminal"), cancel: () => {} };
  const stop = () => cancelled || deps.terminalOf(key) !== terminal || (deps.stateOf !== undefined && deps.stateOf(key) !== "waiting") || deps.current(key) !== card.id;
  const done = enqueue(terminal, () => typeSteps(steps, (d) => deps.write(terminal, d), deps.sleep, stop)).then(
    (ok): QuestionOutcome => (ok ? "sent" : "stopped"),
    (): QuestionOutcome => "stopped",
  );
  return { done, cancel: () => void (cancelled = true) };
}
