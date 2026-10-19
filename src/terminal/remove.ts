// TERM-003: removing a pane whose session already started asks first (Cancel focused, so a stray
// Enter keeps it running); an unstarted pane or an idle shell goes without a question. The default
// reaction is a setting: "ask" or "stop". ponytail: the card's third answer, "sleep", needs a
// per-session sleep that does not exist yet (only workspaces sleep, PROJ-053), so a "sleep" value
// reads as "ask" until it does.
import type { Kind } from "./status";

export const REMOVE_FIELD = "removeStartedSession";

export type RemoveSetting = "ask" | "stop";
export type SessionKind = "unstarted" | "agent" | "shell" | "idle" | "ended";

export const readRemove = (settings: Record<string, unknown>): RemoveSetting => (settings[REMOVE_FIELD] === "stop" ? "stop" : "ask");

/** Agent panes whose program ended and that then started a shell on Enter (TERM-111), by pane key: what runs in them is a
 *  shell, so removing asks as for a shell. TerminalPane keeps it; the window reads it when it classifies. */
export const shellInAgentPane = new Set<number>();

/** The wiring of that set, pure (FIX-2): when a pane's program restarts, `shell` says whether a shell starts in it. Only an
 *  agent pane getting a shell is in the set; a real restart or a shell pane takes the key out; a pane with no key is not tracked. */
export const markShell = (set: Set<number>, key: number | undefined, shell: boolean, agent: string): void => {
  if (key === undefined) return;
  if (shell && agent !== "shell") set.add(key);
  else set.delete(key);
};

/** The pane's report of its program to the window, from its status kind (FIX-2, pure; TerminalPane calls it): undefined
 *  while the program is still starting (the window keeps asking before removal and shows "Starting"), true while it runs,
 *  false once it ended or could not start. Before FIX-1 a starting pane read as false, so it was dropped without a question. */
export const runningOf = (kind: Kind): boolean | undefined => (kind === "starting" ? undefined : kind === "running");

/** What a pane holds: a chooser not started yet, a running agent, an agent whose program has ended, a shell with a program
 *  in it, or an idle shell. T-151-c: `running` is the pane's own report: undefined while its program is still starting,
 *  true while it lives, false once it is gone. Only false means nothing is left to stop, so an agent pane reporting
 *  false is "ended", never "agent"; one still starting (undefined) is asked about like a running one. `inShell`: the
 *  pane is an agent pane now running a shell (FIX-1), so it is classified by that shell, not by `pane.agent`. */
export const classify = (pane: { agent: string; seats?: unknown }, busy: boolean, running?: boolean, inShell = false): SessionKind =>
  pane.seats ? "unstarted" : pane.agent !== "shell" && !inShell ? (running === false ? "ended" : "agent") : busy ? "shell" : "idle";

/** Whether removing goes straight through, stops without asking (the setting), or asks first. */
export const removePlan = (settings: Record<string, unknown>, kind: SessionKind): "remove" | "stop" | "ask" => (kind === "unstarted" || kind === "idle" || kind === "ended" ? "remove" : readRemove(settings) === "stop" ? "stop" : "ask");

export const removeQuestion = (name: string, kind: SessionKind): { title: string; body: string } => ({
  title: `Stop “${name}”?`,
  body: kind === "agent" ? "Its agent is still running. Removing the pane stops it." : "A program is still running in this shell. Removing the pane stops it.",
});
