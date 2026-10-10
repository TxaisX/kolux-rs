// The pane header's status word, its tone and icon (TERM-020, TERM-021, TERM-023), and the
// "next that needs you" cycle (TERM-030, STAT-051, VIEW-047). Pure, tested on its own.
// What an agent needs (permission, waiting, blocked, interrupted) and when it is done come from
// the status hooks (STAT-001, T-025) through `hook`; `needs` is the pane's own flag.

import type { AgentState } from "../projects/rows";

export type Kind = "starting" | "running" | "ended" | "failed";
export type Tone = "" | "working" | "done" | "attention";
export type Header = { word: string; tone: Tone; icon: "working" | "done" | "idle"; age: string; needsYou: boolean };
/** STAT-026: a lead session's sub-agents and teammates as the hooks report them. */
export type Crew = { id: string; kind: string; model?: string; state: "working" | "permission" | "waiting" | "idle" }[];

/** "2 agents", or "1 agent, 1 waiting" when some need the user. */
export function crewLabel(crew: Crew): string {
  const n = crew.length;
  const waiting = crew.filter((c) => c.state === "permission" || c.state === "waiting").length;
  return `${n} agent${n === 1 ? "" : "s"}${waiting ? `, ${waiting} waiting` : ""}`;
}

/** One roster line: role, model and state (the hover text). */
export function crewLine(c: Crew[number]): string {
  return `${c.kind}${c.model ? ` (${c.model})` : ""} · ${c.state === "permission" ? "needs you" : c.state}`;
}

/** TERM-023: "just now" in the first minute, then whole minutes. */
export function ageLabel(finishedAt: number, now: number): string {
  const m = Math.floor((now - finishedAt) / 60000);
  return m < 1 ? "just now" : `${m}m ago`;
}

export function headerOf(agent: string, kind: Kind, code: number | null | undefined, needs: boolean, finishedAt: number | null, now: number, hook?: AgentState): Header {
  const h = (word: string, tone: Tone, icon: Header["icon"], needsYou = false, age = ""): Header => ({ word, tone, icon, age, needsYou });
  if (kind === "failed") return h("Failed", "attention", "idle", true);
  if (kind === "starting") return h("Starting", agent === "shell" ? "" : "working", "working");
  if (kind === "running") {
    if (agent === "shell") return h("Ready", "", "done");
    if (hook === "blocked") return h("Blocked", "attention", "idle", true);
    if (hook === "interrupted") return h("Interrupted", "attention", "idle", true);
    if (needs || hook === "permission" || hook === "waiting") return h("Needs you", "attention", "done", true);
    if (hook === "done") return h("Done", "done", "done", false, finishedAt === null ? "" : ageLabel(finishedAt, now));
    return h("Working", "working", "done");
  }
  if (agent !== "shell" && !code) return h("Done", "done", "done", false, finishedAt === null ? "" : ageLabel(finishedAt, now));
  return h(`Ended${code ? ` (${code})` : ""}`, "", "idle");
}

/** The next pane after `focused` (in grid order, wrapping) that needs the user; null with none. */
export function nextNeedsYou(keys: number[], needs: Set<number>, focused: number): number | null {
  const i = keys.indexOf(focused);
  return [...keys.slice(i + 1), ...keys.slice(0, i + 1)].find((k) => needs.has(k)) ?? null;
}
