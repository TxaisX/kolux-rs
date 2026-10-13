// The one status vocabulary (STAT-052): every dot, badge and header reads its word, glyph, tone
// and hover explanation from `VOCAB`. The pane header's word (TERM-020, TERM-021, TERM-023) and
// the "next that needs you" cycle (TERM-030, STAT-051, VIEW-047) live here too. Pure, tested on
// its own. What an agent needs (permission, waiting, blocked, interrupted) and when it is done
// come from the status hooks (STAT-001, T-025) through `hook`; `needs` is the pane's own flag.

import type { GlyphName } from "../chrome/icons";
import type { AgentState } from "../projects/rows";

export type Kind = "starting" | "running" | "ended" | "failed";
export type Tone = "" | "working" | "done" | "attention";
/** The card's ten states, the Agents view's starting / cannot-reach / stopped, and Kolux's queued. */
export type StatusKey = AgentState | "background" | "failed" | "stale" | "starting" | "unreachable" | "stopped";
export type Vocab = { word: string; glyph: GlyphName; tone: Tone; explain: string };

const needsYou: Omit<Vocab, "word" | "explain"> = { glyph: "attention", tone: "attention" };
export const VOCAB: Record<StatusKey, Vocab> = {
  working: { word: "Working", glyph: "spinner", tone: "working", explain: "The agent is working on its turn." },
  background: { word: "Working", glyph: "background", tone: "working", explain: "The turn is over, but Kolux is watching the agent's background tasks." },
  blocked: { ...needsYou, word: "Blocked", explain: "The agent cannot go on: a limit, a sign-in or an error. Open the pane to see why." },
  waiting: { ...needsYou, word: "Needs you", explain: "The agent asked a question and is waiting for your answer." },
  permission: { ...needsYou, word: "Needs you", explain: "The agent needs your permission for a tool." },
  interrupted: { word: "Interrupted", glyph: "interrupted", tone: "attention", explain: "The turn was stopped before it finished." },
  failed: { word: "Failed", glyph: "failed", tone: "attention", explain: "The program could not start." },
  done: { word: "Done", glyph: "check", tone: "done", explain: "The agent finished its turn." },
  idle: { word: "Idle", glyph: "idle", tone: "", explain: "Nothing is running here." },
  queued: { word: "Queued", glyph: "idle", tone: "", explain: "Waiting for its turn to start." },
  stale: { word: "No recent update", glyph: "stale", tone: "", explain: "No status has arrived from this agent for a while." },
  starting: { word: "Starting", glyph: "spinner", tone: "working", explain: "The program is starting up." },
  unreachable: { word: "Cannot reach", glyph: "failed", tone: "attention", explain: "Kolux cannot talk to this agent." },
  stopped: { word: "Stopped", glyph: "idle", tone: "", explain: "The program has stopped." },
};

/** A stopped label says what caused the stop. */
export function stoppedLabel(cause: string): string {
  return `Stopped: ${cause}`;
}

export type Header = Vocab & { state: StatusKey; age: string; needsYou: boolean };
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

/** The header is the vocabulary applied to what the pane knows; a shell keeps its own neutral words (TERM-020). */
/** ACCT-050: the agent a shell pane's header shows for one the user started by hand; an agent the
 *  header has no mark for, or an unclear answer, leaves the pane a shell. */
export const foundAgent = (a: string | null): "claude" | "codex" | null => (a === "claude" || a === "codex" ? a : null);

export function headerOf(agent: string, kind: Kind, code: number | null | undefined, needs: boolean, finishedAt: number | null, now: number, hook?: AgentState): Header {
  const h = (state: StatusKey, over: Partial<Header> = {}): Header => ({ ...VOCAB[state], state, age: "", needsYou: VOCAB[state].tone === "attention", ...over });
  const done = () => h("done", { age: finishedAt === null ? "" : ageLabel(finishedAt, now) });
  if (kind === "failed") return h("failed");
  if (kind === "starting") return h("starting", agent === "shell" ? { tone: "" } : {});
  if (kind === "running") {
    if (agent === "shell") return h("idle", { word: "Ready", explain: "The shell is ready for a command." });
    if (hook === "blocked" || hook === "interrupted" || hook === "waiting") return h(hook);
    if (needs || hook === "permission") return h("permission");
    if (hook === "done") return done();
    return h("working");
  }
  if (agent !== "shell" && !code) return done();
  return h("stopped", { word: `Ended${code ? ` (${code})` : ""}`, explain: stoppedLabel(code ? `exit code ${code}` : "exited") });
}

/** The next pane after `focused` (in grid order, wrapping) that needs the user; null with none. */
export function nextNeedsYou(keys: number[], needs: Set<number>, focused: number): number | null {
  const i = keys.indexOf(focused);
  return [...keys.slice(i + 1), ...keys.slice(0, i + 1)].find((k) => needs.has(k)) ?? null;
}

/** TERM-022: the header chip: the branch, else the short commit of a detached HEAD; none outside git. */
export function branchChip(git: { branch: string | null; head: string | null } | null): { text: string; tip: string } | null {
  if (!git) return null;
  if (git.branch) return { text: git.branch, tip: git.branch };
  return git.head ? { text: git.head.slice(0, 7), tip: `Detached at ${git.head}` } : null;
}
