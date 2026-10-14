// Native chat, the send path (CHAT-020, CHAT-022; T-327, council FIX-1 on a969502). A message is typed
// into the agent's terminal only while Kolux can see that the agent is not asking anything there:
// a menu's default answer is Yes, so a send's Enter landing in one would approve it. Every reading is
// looked up by the send's own pane, at every write, never by the pane the screen shows now.
import type { AgentState } from "../projects/rows";
import { LIMIT } from "../terminal/paste";
import { ASKING_NOTE, asksInTerminal, enqueue, sendSteps, typeSteps } from "./composer";

/** CHAT-022: what the box says when Kolux has no hook reading for the pane (hooks off for it, Codex
 * trust not given, an agent with no hook route, or no event yet). */
export const UNSEEN_NOTE = "Kolux can't see this agent's prompts. Type in its terminal.";
/** CHAT-020: what the box says when a message is longer than one paste may be. */
export const TOO_LONG_NOTE = "This message is too long to send from chat. Shorten it or paste it in the terminal.";

/** The hook states in which the agent is known not to show a menu. Anything else (no reading, a
 * menu, a word this build does not know) holds the send. */
const CLEAR: readonly AgentState[] = ["working", "queued", "done", "idle", "interrupted", "blocked"];
const clear = (s: string | undefined) => s !== undefined && (CLEAR as readonly string[]).includes(s);

/** CHAT-022: why a send to a pane is held, or undefined when it may go. `app`: the window's own hook
 * reading for the pane (it alone knows hooks were turned off); `ear`: the newest hook event the chat
 * heard for it. Either one asking holds the send; with no window reading the event decides. */
export function holdNote(app: string | undefined, ear: string | undefined, hasApp = app !== undefined): string | undefined {
  if (asksInTerminal(app) || asksInTerminal(ear)) return ASKING_NOTE;
  return clear(hasApp ? app : ear) ? undefined : UNSEEN_NOTE;
}

type Listen = (name: string, h: (e: { payload: { paneKey: number; state?: string } }) => void) => Promise<unknown>;
const heard = new Map<number, string>();
let hearing: Promise<unknown> | null = null;
/** One listener for the whole window: it keeps every pane's newest hook state, so a send to a pane
 * that left the screen still hears that pane's menu open. Safe to call on every mount. */
export function hearStates(listen: Listen): Promise<unknown> {
  if (!hearing)
    hearing = listen("agent-status", (e) => {
      if (e.payload.state !== undefined) heard.set(e.payload.paneKey, e.payload.state);
    });
  return hearing;
}
export const heardOf = (key: number) => heard.get(key);
/** For tests: drops every reading and the listener. */
export function forgetHearing() {
  heard.clear();
  hearing = null;
}

export type SendDeps = {
  /** The pane's program session now (asked at send time, so a reconnect's new session is used). */
  terminalOf: (key: number) => number | undefined;
  /** The window's hook reading for a pane, read live (not the value of the last render). */
  stateOf?: (key: number) => string | undefined;
  write: (terminal: number, data: string) => Promise<unknown>;
  sleep?: (ms: number) => Promise<unknown>;
};
export type SendOutcome = "sent" | "held" | "stopped" | "too-long" | "no-terminal";

/** Why a send to pane `key` would be held right now, or undefined. When the window gives its
 * readings, its "no reading" holds the send even if an older event said the agent was working
 * (the window drops a pane's reading when its hooks are turned off). */
export const holdFor = (key: number, stateOf?: (key: number) => string | undefined) => holdNote(stateOf?.(key), heardOf(key), stateOf !== undefined);

/** CHAT-020, CHAT-022: types `text` into pane `key`'s terminal, after any earlier send to it. Before
 * every write (the Enter above all) the pane's own readings are checked again; once one is not clear
 * the rest is dropped and "stopped" comes back. */
export async function sendToPane(key: number, agent: string | undefined, text: string, deps: SendDeps): Promise<SendOutcome> {
  if (text.length > LIMIT) return "too-long";
  const terminal = deps.terminalOf(key);
  if (terminal === undefined) return "no-terminal";
  const held = () => holdFor(key, deps.stateOf) !== undefined;
  if (held()) return "held";
  const done = await enqueue(terminal, () => typeSteps(sendSteps(agent, text), (d) => deps.write(terminal, d), deps.sleep, held));
  return done ? "sent" : "stopped";
}
