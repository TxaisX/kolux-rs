import { locale } from "../language";
// Codex plan figures as the usage pill shows them (USAGE-022). The Rust side reads them without
// opening a session; this file only turns the reply into words.
import { weeklyLine } from "./claude";

export type UsageWindow = { usedPercent: number; resetsAt: number | null; windowMins: number | null };
export type CodexUsage = {
  state: "ok" | "signed-out" | "sign-in-again" | "api-key" | "busy" | "error";
  fiveHour: UsageWindow | null;
  weekly: UsageWindow | null;
  resetCredits: number | null;
  plan: string | null;
  message: string | null;
};

const left = (w: UsageWindow) => `${Math.max(0, Math.round(100 - w.usedPercent))}% left`;

/** "Mon 14:05" in the user's own clock; `now` keeps tests stable. */
export function resetWords(at: number | null, now: Date = new Date()): string {
  if (at == null) return "reset time unknown";
  const d = new Date(at * 1000);
  const time = d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  const sameDay = d.toDateString() === now.toDateString();
  return `resets ${sameDay ? "today" : d.toLocaleDateString(locale(), { weekday: "short" })} ${time}`;
}

/** The pill text: the weekly figure alone (USAGE-008); the 5-hour window never shows here. */
export function pillText(u: CodexUsage | null): string {
  if (!u) return "Codex · reading";
  switch (u.state) {
    case "ok":
      return u.weekly ? `Codex ${left(u.weekly)}` : "Codex · no weekly limit reported";
    case "signed-out":
      return "Codex · not signed in";
    case "sign-in-again":
      return "Codex · sign in again";
    case "api-key":
      return "Codex · API key";
    case "busy":
      return "Codex · reading";
    default:
      return "Codex · unknown";
  }
}

/** The hover text: the weekly limit with a countdown to its reset, then the reset credits and plan. */
export function pillDetail(u: CodexUsage | null, now: Date = new Date()): string {
  if (!u || u.state === "busy") return "Reading Codex usage";
  if (u.state === "sign-in-again") return `Codex needs you to sign in again. ${u.message ?? ""}`.trim();
  if (u.state === "signed-out") return "No Codex sign-in found, so nothing was started";
  if (u.state === "api-key") return "Codex is signed in with an API key; keys have no plan limits to show";
  if (u.state !== "ok") return u.message ?? "Codex usage could not be read";
  const lines: string[] = [];
  if (u.weekly) lines.push(weeklyLine(u.weekly.usedPercent, u.weekly.resetsAt && u.weekly.resetsAt * 1000, now.getTime()));
  if (u.resetCredits != null) lines.push(`Limit-reset credits: ${u.resetCredits}`);
  if (u.plan) lines.push(`Plan: ${u.plan}`);
  return lines.join("\n") || "Codex reported no weekly limit";
}
