// Claude's rate-limit windows as the usage pill shows them (STAT-040). Claude Code reports them
// through its status line; the Rust side keeps the last report and this file turns it into words.
import { resetWords } from "../terminal/notify";

export type ClaudeLimit = { kind: string; usedPercent: number; resetsAt: number | null };

const WORDS: Record<string, string> = { five_hour: "5-hour", seven_day: "Weekly", spend_limit: "Spend" };
const left = (l: ClaudeLimit) => `${Math.max(0, Math.round(100 - l.usedPercent))}% left`;

/** The window the pill shows: one that is used up, else the weekly one, else the 5-hour one, else the first. */
export const pillWindow = (limits: ClaudeLimit[]): ClaudeLimit | undefined =>
  limits.find((l) => l.usedPercent >= 100) ?? limits.find((l) => l.kind === "seven_day") ?? limits.find((l) => l.kind === "five_hour") ?? limits[0];

export function pillText(limits: ClaudeLimit[]): string {
  const w = pillWindow(limits);
  return w ? `Claude ${left(w)}` : "Claude · unknown";
}

/** The hover text: each window on its own line with its reset time when one was given. */
export function pillDetail(limits: ClaudeLimit[]): string {
  if (limits.length === 0) return "Claude's limits appear once a Claude Code session reports them through its status line. Click for AI connections.";
  return limits.map((l) => `${WORDS[l.kind] ?? l.kind}: ${left(l)}${l.resetsAt ? `, resets at ${resetWords(l.resetsAt)}` : ""}`).join("\n");
}
