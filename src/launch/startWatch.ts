// SESS-005 / SESS-032 (T-163): what the user hears when an agent will not start, or when its opening
// prompt does not reach it. The Rust side refuses a start line it cannot build before any pane is
// made (agents.rs `command_check`, worded with the agent's name) and hands the opening prompt over
// exactly once (`agent_prompt_send`, the send-once machine of ORCH-055). This side keeps the
// five-second watch for an agent pane whose terminal process never shows up, and the words of the
// toasts. App.tsx arms the watch for every shown agent pane, marks it seen when the pane reports its
// terminal id, and prunes it to the panes still shown.

/** SESS-005: how long an agent pane may go without any terminal process before the user is warned. */
export const NO_PROCESS_MS = 5000;

type Timers = { set: (f: () => void, ms: number) => unknown; clear: (t: unknown) => void };
const REAL: Timers = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };

/** SESS-005: the warning for an agent pane that has had no terminal process for five seconds. */
export const noProcessWarning = (agentName: string): string => `${agentName} has not started: no terminal process appeared after ${NO_PROCESS_MS / 1000} seconds. Check its command under Settings > Agents.`;

/** SESS-005: one timer per agent pane from the moment it is shown until its process shows up. The
 *  warning fires only when there is no process at all, never for an agent that is slow to paint:
 *  `seen` (the pane reported its terminal id, or its own failure toast said why) stops the timer
 *  and keeps the pane from being armed again; `prune` forgets panes no longer shown, so a pane shown
 *  again later (or restarted under a new key) starts a fresh watch. */
export class StartWatch {
  private readonly armed = new Map<number, unknown>();
  private readonly done = new Set<number>();

  constructor(private readonly timers: Timers = REAL) {}

  arm(key: number, agentName: string, warn: (text: string) => void): void {
    if (this.armed.has(key) || this.done.has(key)) return;
    this.armed.set(
      key,
      this.timers.set(() => {
        if (this.armed.delete(key)) {
          this.done.add(key);
          warn(noProcessWarning(agentName));
        }
      }, NO_PROCESS_MS),
    );
  }

  /** The pane's process showed up, or its failure was already reported: no warning, now or later. */
  seen(key: number): void {
    this.done.add(key);
    const t = this.armed.get(key);
    if (t === undefined) return;
    this.armed.delete(key);
    this.timers.clear(t);
  }

  /** Keeps only the panes in `keys`; the rest are forgotten (their timers cleared). */
  prune(keys: Iterable<number>): void {
    const keep = new Set(keys);
    for (const [k, t] of [...this.armed]) {
      if (keep.has(k)) continue;
      this.armed.delete(k);
      this.timers.clear(t);
    }
    for (const k of [...this.done]) if (!keep.has(k)) this.done.delete(k);
  }

  /** The panes with a watch running. */
  get watching(): number[] {
    return [...this.armed.keys()];
  }
}

/** The one watch the window uses (module state, so App.tsx holds no state of its own for it). */
export const startWatch = new StartWatch();

/** What Rust answers for an opening prompt (agents.rs `PromptSent`). */
export type PromptSent = { outcome: string; why: string | null };

/** SESS-032: the toast for an opening prompt that did not go in; null when it went (or this
 *  terminal was served already, which is not news). A prompt typed in but never submitted counts
 *  as not sent: the user has to press Enter, so they are told. */
export function promptLost(agentName: string, sent: PromptSent): string | null {
  if (sent.outcome === "sent" || sent.outcome === "text_only" || sent.outcome === "duplicate") return null;
  const typedIn = sent.outcome === "held_permission" || sent.outcome === "stale" || sent.outcome === "cancelled";
  const next = typedIn ? "It is typed in its terminal; press Enter there to send it." : "Type it into its terminal yourself.";
  return `${agentName}'s opening prompt was not sent${sent.why ? `: ${sent.why}` : ""}. ${next}`;
}

type Invoke = <T>(cmd: string, args: Record<string, unknown>) => Promise<T>;

/** SESS-032: hands the opening prompt to terminal `id` exactly once and gives back the toast to
 *  show, or null when nothing needs saying. Never throws: a failed call is a prompt not sent. */
export async function deliverPrompt(invoke: Invoke, id: number, text: string, agentName: string): Promise<string | null> {
  try {
    return promptLost(agentName, await invoke<PromptSent>("agent_prompt_send", { id, text }));
  } catch (err) {
    return promptLost(agentName, { outcome: "failed", why: String(err) });
  }
}
