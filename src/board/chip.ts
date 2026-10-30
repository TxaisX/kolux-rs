// Board cards (VIEW-023) and the one line under each session (VIEW-016): which lane a session
// sits in, one of a fixed set of words, and a short line saying what the agent is doing, all from
// the signals the window already has. Pure, tested on its own.

import type { AgentState } from "../projects/rows";
import { stopLine, type StopInfo } from "../terminal/notify";

export type Lane = "needs" | "working" | "done" | "stopped" | "idle";
export const LANES: Array<{ id: Lane; title: string }> = [
  { id: "needs", title: "Needs you" },
  { id: "working", title: "Working" },
  { id: "done", title: "Done" },
  { id: "stopped", title: "Stopped" },
  { id: "idle", title: "Idle" },
];

export type Signal = {
  agent: string;
  /** The hook-fed state; undefined before the first event. */
  state?: AgentState;
  /** undefined: no process yet; false: the program ended. */
  running?: boolean;
  /** STAT-045: the terminal has printed nothing for the quiet window. */
  stale: boolean;
  tool?: string;
  detail?: string;
  reply?: string;
  /** STAT-022: why the session is stopped, while it is. */
  stop?: StopInfo;
  /** The newest file the agent wrote this session. */
  wrote?: string;
  /** When the state last moved; 0 when unknown. */
  since: number;
  /** STAT-024: the turn is over and Kolux is watching the agent's background tasks. */
  monitoring?: boolean;
  /** STAT-027: the whole question the agent is waiting on, one question per line. */
  ask?: string;
};
export type Chip = { lane: Lane; word: string; line: string; file?: string; answer: boolean };

/** "45s", "4m", "1h 5m". */
export function span(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

/** The opening line of a message, trimmed. */
export function firstLine(s: string): string {
  return s.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
}

/** STAT-027: the questions of a waiting agent as one line, blank lines dropped. */
export function askLine(ask: string | undefined): string {
  return (ask ?? "").split("\n").map((l) => l.trim()).filter(Boolean).join(" · ");
}

/** T-608: the one state every surface reads for a pane: the Board's lane and the Tower's row (chipOf), the
 *  Inbox's group, the needs strip and the bell. The hook's word wins; else, while the program runs, the title
 *  guess the pane header shows (STAT-033); undefined before either has spoken. A pane opened as a plain
 *  terminal has none on any of them, as the Board and the Tower never showed one: an agent started there by
 *  hand keeps its status in its own header and tab (ACCT-050), and its last hook word would go stale there
 *  once it quits. ponytail: the window does not know which agent a plain terminal shows (TerminalPane's
 *  `found`); passing that up would put hand-started agents on all five. */
export function paneStatus(agent: string, hook: AgentState | undefined, guess: AgentState | null | undefined, running: boolean | undefined): AgentState | undefined {
  if (agent === "shell") return undefined;
  return hook ?? (running === true ? (guess ?? undefined) : undefined);
}

/** T-608: what needs you, the same on every surface: a permission or a question (STAT-050, VIEW-023, TERM-029).
 *  A stop (blocked, interrupted) reads Stopped, and the bell does not count it. */
export const needsYou = (state: AgentState | undefined): boolean => state === "permission" || state === "waiting";

/** The most urgent signal wins: an approval, then working, then done, then idle; with no evidence the line stays empty. */
export function chipOf(s: Signal, now: number): Chip | null {
  if (s.agent === "shell") return null;
  const chip = (lane: Lane, word: string, line: string, file?: string): Chip => ({ lane, word, line, file, answer: false });
  const since = s.since > 0 ? span(now - s.since) : "";
  const step = [s.tool, s.detail].filter(Boolean).join(": ");
  if (s.running === undefined) return chip("working", "Starting", "");
  if (s.running === false && s.state !== "done") return chip("stopped", "Stopped", "Exited");
  switch (s.state) {
    case "permission":
      // T-124-c: Approve/Deny only answer a hook PermissionRequest, which names its pending tool; a
      // permission printed in band (OSC 9999) names nothing to answer, so it needs you without buttons.
      return { ...chip("needs", "Needs you", step || "Permission"), answer: Boolean(s.tool) };
    case "waiting":
      // STAT-027: every question asked, on the one line the card has (its tooltip carries the same text).
      return chip("needs", "Needs you", askLine(s.ask) || step || "Question");
    // A stop caused by a limit or sign-in reads Stopped, never Done (STAT-022 names the cause).
    case "blocked":
      return chip("stopped", "Stopped", s.stop ? stopLine(s.stop) : (s.detail ?? ""));
    case "interrupted":
      return chip("stopped", "Stopped", "Interrupted");
    case "done":
      return chip("done", "Done", s.reply ? firstLine(s.reply) : "", s.wrote);
    case "idle":
      return chip("idle", "Idle", since);
    case "queued":
      return chip("working", "Queued", since);
    default:
      // A stale working signal never shows Working. It says what is missing, the status: a long tool
      // can stream output all along (T-124-c).
      if (s.stale) return chip("working", "No recent update", since ? `no status for ${since}` : "");
      if (s.monitoring) return chip("working", "Working", "Watching background tasks");
      return chip("working", "Working", [since, step].filter(Boolean).join(" · "));
  }
}
