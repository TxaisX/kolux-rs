// TERM-031: answering an agent's permission prompt from a Kolux control. The answer is typed into
// the agent only while the prompt the user saw is still the one showing: the pane counts the
// prompts it has shown (one per hook transition into "permission"), and a click carries the count
// it was drawn with. A plain shell never gets an answer.
import type { AgentState } from "../projects/rows";
// MERGE 39: the pane also carries the hooks lane's "background" reading; it is never a prompt.
type Hook = AgentState | "background" | undefined;

export type Answer = "approve" | "deny";

/** The keys each program takes for an answer at its permission prompt. ponytail: Claude Code's
 *  prompt opens with Yes highlighted (Enter takes it, Escape backs out); Codex takes y / n. Other
 *  agents are treated like Codex. */
export const answerKeys = (agent: string, answer: Answer): string | null => {
  if (agent === "shell") return null;
  if (agent === "claude") return answer === "approve" ? "\r" : "\x1b";
  return answer === "approve" ? "y" : "n";
};

/** Council D2 (after MERGE 47): Enter typed into a pane on a guess (the program's title, an OSC report) could land
 *  on whatever is in front of the agent, so the buttons and the answer need a hook PermissionRequest that names
 *  the tool it waits on (`tool`, from the hook's own status), the same thing the window's answer command needs. */
const hookPrompt = (agent: string, hook: Hook, tool: string | undefined) => agent !== "shell" && hook === "permission" && !!tool;

/** True only for an agent pane whose hook still says "permission" for a named tool and whose prompt count has not moved since the control was drawn. */
export const canAnswer = (agent: string, hook: Hook, drawnAt: number, now: number, tool: string | undefined): boolean => hookPrompt(agent, hook, tool) && drawnAt === now;

/** T-151-b (council FIX-SOON): the hook keeps saying "permission" after the user has answered (it only moves
 *  on at the next tool event), so the pane remembers which prompt was answered: the first click, or any
 *  keystroke typed into the pane while the prompt shows, marks the current count answered and the buttons
 *  hide until the count bumps for the next prompt. */
export const buttonsShown = (agent: string, hook: Hook, answered: number, count: number, tool: string | undefined): boolean => hookPrompt(agent, hook, tool) && answered !== count;

/** The prompt count after a hook change: a new "permission" state is a new prompt. */
export const nextPrompt = (count: number, before: Hook, after: Hook): number => (after === "permission" && before !== "permission" ? count + 1 : count);
