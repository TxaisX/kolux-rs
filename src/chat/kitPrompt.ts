// Council FIX-3 (FIX-BEFORE 1 of chat e5412ff; SKILL-008, CHAT-022): when a kit role that waits on
// another role is due, its prompt goes into its agent's terminal only on a clear hook reading. When
// it cannot, the kit strip says why instead of waiting without a sign, and nothing is ever sent by a
// timer: only a clear reading or the user's own Send prompt click puts it in.
import type { KitRun, KitWait } from "../kits/useKits";
import { ASKING_NOTE, enqueue, pasteSteps, typeSteps } from "./composer";
import { tooLong, type SendOutcome } from "./send";

/** How long a due role waits quietly on an agent Kolux cannot read, or one that is asking, before
 * the strip says so. */
export const KIT_NOTICE_MS = 60_000;
/** The agents whose hooks Kolux installs, so their readings can be expected. Codex is not one yet:
 * its hooks are not written (T-025-e), so a Codex seat counts as hookless. */
export const HOOK_AGENTS: readonly string[] = ["claude", "gemini", "antigravity", "amp"];
/** Kolux knows it will never hear from this pane's agent: hooks are off, or the agent has no route. */
export const hooksAbsent = (agent: string | undefined, hooksOn: boolean) => !hooksOn || agent === undefined || !HOOK_AGENTS.includes(agent);

export const readyText = (role: string, agent: string) => `${role} is ready for its prompt, but Kolux can't see whether ${agent} is asking something.`;
export const askingText = (role: string, agent: string) => `${role}'s prompt is waiting: ${agent} is asking something in its terminal. Answer it there.`;
export const stoppedText = (role: string, agent: string) => `${role}'s prompt stopped before its Enter: ${agent} began asking something. Answer it in its terminal, then send the prompt.`;
export const tooLongText = (role: string) => `${role}'s prompt is too long to paste. Copy it into the agent's terminal.`;
/** Stand-in review of 1e9613e, FIX-BEFORE 3: Send prompt refused while Kolux sees a menu open. */
export const askFirstText = (agent: string) => `${agent} is asking something. Answer it in its terminal first.`;
export const NO_TERMINAL_TEXT = "That agent's terminal is not running, so nothing was sent.";
export const TYPE_FAILED_TEXT = "The prompt could not be typed into the terminal.";

export type KitNotice = { kind: "no-hooks" | "unseen" | "asking" | "stopped" | "too-long"; text: string; canSend: boolean };
/** A waiting role as the kit run keeps it, with what this module adds: the role's and the agent's
 * names, when the role became due, the notice showing for it, and whether its one toast went. */
export type KitPromptWait = KitWait & { label?: string; agentName?: string; dueAt?: number; noticed?: KitNotice; toasted?: boolean };

/** The waiting entry for a role, carrying the names its notice uses. */
export const kitWait = (w: KitWait, label: string, agentName: string): KitPromptWait => ({ ...w, label, agentName });
const names = (w: KitPromptWait) => [w.label ?? w.role, w.agentName ?? "the agent"] as const;

export type KitStep = { paste: boolean; changed: boolean; toast?: string };
/** One tick for a due role at `now`: whether to try the gated paste, whether its notice changed, and
 * a toast to show. `why`: the send check's hold reason for the pane (undefined = clear); `absent`:
 * hooks are known absent for it. */
export function kitStep(wait: KitWait, now: number, why: string | undefined, absent: boolean): KitStep {
  const w = wait as KitPromptWait;
  const before = w.noticed?.text;
  w.dueAt ??= now;
  // Ruling 4: a prompt that stopped mid-paste is never pasted again by the timer.
  if (w.noticed?.kind === "stopped" || w.noticed?.kind === "too-long") return { paste: false, changed: false };
  const [role, agent] = names(w);
  const late = now - w.dueAt >= KIT_NOTICE_MS;
  let paste = false;
  let toast: string | undefined;
  if (absent) w.noticed = { kind: "no-hooks", text: readyText(role, agent), canSend: true };
  else if (why === undefined) paste = true;
  else if (why === ASKING_NOTE) w.noticed = late ? { kind: "asking", text: askingText(role, agent), canSend: false } : undefined;
  else if (late) {
    w.noticed = { kind: "unseen", text: readyText(role, agent), canSend: true };
    if (!w.toasted) toast = w.noticed.text;
    w.toasted = true;
  } else w.noticed = undefined;
  return toast === undefined ? { paste, changed: w.noticed?.text !== before } : { paste, changed: w.noticed?.text !== before, toast };
}

/** What a gated paste's outcome means for the role: `sent` (it leaves the waiting list) and whether
 * its notice changed. "stopped" (a menu opened mid-paste) shows the notice and stops the retries. */
export function kitPasted(wait: KitWait, got: SendOutcome | null): { sent: boolean; changed: boolean } {
  const w = wait as KitPromptWait;
  const before = w.noticed?.text;
  const [role, agent] = names(w);
  if (got === "sent") w.noticed = undefined;
  else if (got === "stopped") w.noticed = { kind: "stopped", text: stoppedText(role, agent), canSend: true };
  else if (got === "too-long") w.noticed = { kind: "too-long", text: tooLongText(role), canSend: false };
  return { sent: got === "sent", changed: w.noticed?.text !== before };
}

/** The notices to show for a run's waiting roles. */
export const kitNotices = (waiting: readonly KitWait[]) =>
  waiting.flatMap((wait) => {
    const w = wait as KitPromptWait;
    return w.noticed ? [{ wait, notice: w.noticed }] : [];
  });

/** Send prompt: the user saw the notice and chose to send, so the prompt goes in with no state check:
 * the input line cleared, one bracketed paste, then Enter. True when every write went. */
export const pasteUnchecked = (terminal: number, prompt: string, write: (terminal: number, data: string) => Promise<unknown>, sleep?: (ms: number) => Promise<unknown>, asking: () => boolean = () => false) =>
  enqueue(terminal, () => typeSteps(pasteSteps(prompt, true), (d) => write(terminal, d), sleep, asking));

export type SendPromptDeps = {
  /** The role's terminal now, or undefined when its program is not running. */
  terminal: number | undefined;
  /** The send check's hold reason for the role's pane right now (holdFor), asked before every write. */
  why: () => string | undefined;
  write: (terminal: number, data: string) => Promise<unknown>;
  /** Shows the user a toast. */
  say: (text: string) => void;
  /** The run's waiting list or a notice changed (the strip redraws). */
  changed: () => void;
  sleep?: (ms: number) => Promise<unknown>;
  now?: () => number;
};
/** Send prompt, the user's own click on a notice (stand-in review of 1e9613e, FIX-BEFORE 3, AFTER 2).
 * The paste is unchecked only while Kolux cannot see: when its reading says the agent is asking (a
 * menu whose default is Yes), nothing is typed and the toast says to answer it first, also when the
 * menu is reported between the paste and its Enter. A prompt too long for one paste, or a pane with
 * no running program, is refused with its reason. True when the prompt went in; the role then leaves
 * the run's waiting list. */
export async function sendPrompt(run: Pick<KitRun, "waiting" | "sent">, wait: KitWait, deps: SendPromptDeps): Promise<boolean> {
  const w = wait as KitPromptWait;
  const [role, agent] = names(w);
  const asking = () => deps.why() === ASKING_NOTE;
  if (deps.terminal === undefined) return void deps.say(NO_TERMINAL_TEXT), false;
  if (tooLong(w.prompt)) return void deps.say(tooLongText(role)), false;
  if (asking()) return void deps.say(askFirstText(agent)), false;
  const ok = await pasteUnchecked(deps.terminal, w.prompt, deps.write, deps.sleep, asking).catch(() => null);
  if (ok === null) return void deps.say(TYPE_FAILED_TEXT), false;
  if (!ok) {
    kitPasted(w, "stopped");
    deps.say(askFirstText(agent));
    deps.changed();
    return false;
  }
  run.waiting = run.waiting.filter((x) => x !== wait);
  run.sent[w.role] = (deps.now ?? Date.now)();
  deps.changed();
  return true;
}

/** Copy prompt: the role's prompt to the clipboard; `say` gets what to tell the user. */
export const copyPrompt = (wait: KitWait, say: (text: string) => void) =>
  navigator.clipboard.writeText(wait.prompt).then(
    () => say(`${names(wait as KitPromptWait)[0]}'s prompt is copied. Paste it into its terminal.`),
    () => say("Kolux could not copy the prompt. Open the kit's role file instead."),
  );
