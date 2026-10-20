// T-259 (STAT-036): how many agents are working in each workspace. Pure, so the counting rules are
// tested on their own; App.tsx hands the result to the sidebar through each row's info.
import { paneState, type AgentState } from "../projects/rows";

type CountedPane = { key: number; cwd: string | null; agent: string; kind?: string; seats?: unknown };

/** Whether a pane is one agent seat the sidebar counts: a shell, a browser tab and a kit's multi-seat tab are not. */
export function countsAsAgent(p: CountedPane): boolean {
  return p.cwd !== null && p.agent !== "shell" && p.kind !== "browser" && !p.seats;
}

/**
 * Working agents per workspace folder (keyed by the pane's own cwd, as the sidebar's row states are).
 * Split panes are separate panes, so two halves running an agent each count two. When a pane has no
 * hook-fed state (pane-level titles are not available), its program being up counts it, the same
 * guess the row's dot makes; an ended program never counts.
 */
export function workingByDir(panes: CountedPane[], hook: Record<number, AgentState>, running: Record<number, boolean>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of panes) {
    if (!countsAsAgent(p)) continue;
    const state = hook[p.key] ?? paneState(p.agent, running[p.key]);
    if (state === "working") out[p.cwd as string] = (out[p.cwd as string] ?? 0) + 1;
  }
  return out;
}

/** What the sidebar says beside a workspace: "2 working", or nothing for none. */
export function workingWord(n: number | undefined): string {
  return n !== undefined && n > 0 ? `${n} working` : "";
}

/** A sleeping workspace, or one with no pane open, is inactive: it never shows a working count. */
export function inactive(asleep: boolean, open: number): boolean {
  return asleep || open === 0;
}
