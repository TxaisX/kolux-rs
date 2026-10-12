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
      return { ...chip("needs", "Needs you", step || "Permission"), answer: true };
    case "waiting":
      return chip("needs", "Needs you", step || "Question");
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
      // A stale working signal never shows Working.
      if (s.stale) return chip("working", "No recent update", since ? `${since} without output` : "");
      return chip("working", "Working", [since, step].filter(Boolean).join(" · "));
  }
}
