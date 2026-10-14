// TERM-031: answering an agent's permission prompt from a Kolux control. The answer is typed into
// the agent only while the prompt the user saw is still the one showing: the pane counts the
// prompts it has shown (one per hook transition into "permission"), and a click carries the count
// it was drawn with. A plain shell never gets an answer.
import type { AgentState } from "../projects/rows";

export type Answer = "approve" | "deny";

/** The keys each program takes for an answer at its permission prompt. ponytail: Claude Code's
 *  prompt opens with Yes highlighted (Enter takes it, Escape backs out); Codex takes y / n. Other
 *  agents are treated like Codex. */
export const answerKeys = (agent: string, answer: Answer): string | null => {
  if (agent === "shell") return null;
  if (agent === "claude") return answer === "approve" ? "\r" : "\x1b";
  return answer === "approve" ? "y" : "n";
};

/** True only for an agent pane whose hook still says "permission" and whose prompt count has not moved since the control was drawn. */
export const canAnswer = (agent: string, hook: AgentState | undefined, drawnAt: number, now: number): boolean => agent !== "shell" && hook === "permission" && drawnAt === now;

/** T-151-b (council FIX-SOON): the hook keeps saying "permission" after the user has answered (it only moves
 *  on at the next tool event), so the pane remembers which prompt was answered: the first click, or any
 *  keystroke typed into the pane while the prompt shows, marks the current count answered and the buttons
 *  hide until the count bumps for the next prompt. */
export const buttonsShown = (agent: string, hook: AgentState | undefined, answered: number, count: number): boolean => agent !== "shell" && hook === "permission" && answered !== count;

/** The prompt count after a hook change: a new "permission" state is a new prompt. */
export const nextPrompt = (count: number, before: AgentState | undefined, after: AgentState | undefined): number => (after === "permission" && before !== "permission" ? count + 1 : count);
