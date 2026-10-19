// TERM-003: removing a pane whose session already started asks first (Cancel focused, so a stray
// Enter keeps it running); an unstarted pane or an idle shell goes without a question. The default
// reaction is a setting: "ask" or "stop". ponytail: the card's third answer, "sleep", needs a
// per-session sleep that does not exist yet (only workspaces sleep, PROJ-053), so a "sleep" value
// reads as "ask" until it does.
export const REMOVE_FIELD = "removeStartedSession";

export type RemoveSetting = "ask" | "stop";
export type SessionKind = "unstarted" | "agent" | "shell" | "idle" | "ended";

export const readRemove = (settings: Record<string, unknown>): RemoveSetting => (settings[REMOVE_FIELD] === "stop" ? "stop" : "ask");

/** What a pane holds: a chooser not started yet, a running agent, an agent whose program has ended, a shell with a program
 *  in it, or an idle shell. T-151-c: `running` is the pane's own report (false once its program is gone, true or unknown
 *  while it lives); an agent pane that reports false has nothing left to stop, so it is "ended", never "agent". */
export const classify = (pane: { agent: string; seats?: unknown }, busy: boolean, running?: boolean): SessionKind =>
  pane.seats ? "unstarted" : pane.agent !== "shell" ? (running === false ? "ended" : "agent") : busy ? "shell" : "idle";

/** Whether removing goes straight through, stops without asking (the setting), or asks first. */
export const removePlan = (settings: Record<string, unknown>, kind: SessionKind): "remove" | "stop" | "ask" => (kind === "unstarted" || kind === "idle" || kind === "ended" ? "remove" : readRemove(settings) === "stop" ? "stop" : "ask");

export const removeQuestion = (name: string, kind: SessionKind): { title: string; body: string } => ({
  title: `Stop “${name}”?`,
  body: kind === "agent" ? "Its agent is still running. Removing the pane stops it." : "A program is still running in this shell. Removing the pane stops it.",
});
