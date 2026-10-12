// The usage meters (USAGE-005): how a session's context reading and its agent's plan figures
// become the Board card's meter, the tab ring and the pane header's percentage.
import type { ClaudeLimit } from "./claude";
import type { CodexUsage } from "./codex";

export type ContextReading = { tokens: number; window: number };
export type PlanFigures = { fiveHour: number | null; weekly: number | null };
export type Meter = { context?: ContextReading & { percent: number }; plan?: PlanFigures };

/** USAGE-006: the window every session is held to while the cap is on. */
export const CAP = 200_000;

/** Context fill, 0 to 100, against the effective window: the cap while it is on, else the model's own. */
// ponytail: the cap is always on until T-041 wires the USAGE-006 switch through this argument.
export function contextFill(r: ContextReading, capped = true): number {
  const window = capped ? CAP : r.window;
  if (window <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((r.tokens / window) * 100)));
}

/** 84k, 1.3M, 950. */
export function shortTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
}

/** USAGE-002: yellow at 70%, red past 90%, the same scale on the card bar and the pane header. */
export const tone = (percent: number): "" | "warn" | "danger" => (percent > 90 ? "danger" : percent >= 70 ? "warn" : "");

const pct = (n: number | undefined) => (n === undefined || !Number.isFinite(n) ? null : Math.min(100, Math.max(0, Math.round(n))));

/** The plan figures for a session's agent: Claude to the Claude account, Codex to Codex, none for the rest or when the read failed. */
export function planOf(agent: string, claude: ClaudeLimit[], codex: CodexUsage | null): PlanFigures | null {
  let p: PlanFigures | null = null;
  if (agent === "claude") p = { fiveHour: pct(claude.find((l) => l.kind === "five_hour")?.usedPercent), weekly: pct(claude.find((l) => l.kind === "seven_day")?.usedPercent) };
  if (agent === "codex" && codex?.state === "ok") p = { fiveHour: pct(codex.fiveHour?.usedPercent), weekly: pct(codex.weekly?.usedPercent) };
  return p && (p.fiveHour !== null || p.weekly !== null) ? p : null;
}

/** The card's meter, or null when there is neither a context reading nor plan figures (USAGE-002). */
export function meterOf(ctx: ContextReading | undefined, agent: string, claude: ClaudeLimit[], codex: CodexUsage | null, capped = true): Meter | null {
  const m: Meter = {};
  if (ctx) m.context = { ...ctx, percent: contextFill(ctx, capped) };
  const plan = planOf(agent, claude, codex);
  if (plan) m.plan = plan;
  return m.context || m.plan ? m : null;
}

/** The hover text shared by the card meter, the tab ring and the header gauge. */
export function meterText(m: Meter): string {
  const lines: string[] = [];
  if (m.context) lines.push(`Context ${shortTokens(m.context.tokens)} / ${shortTokens(m.context.window)} (${m.context.percent}%)`);
  if (m.plan) lines.push([m.plan.fiveHour !== null && `5-hour ${m.plan.fiveHour}%`, m.plan.weekly !== null && `Weekly ${m.plan.weekly}%`].filter(Boolean).join(" · "));
  return lines.join("\n");
}
