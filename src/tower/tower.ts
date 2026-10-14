// The control tower (OD-09 / DT-C35, T-546): one always-on overview of every agent pane, what
// each is doing, what needs him, the plan usage per account, and the pane each row jumps to.
// Pure: the window hands in what it already computes for the Board (the chip and the meter of
// each pane) and this file only orders and groups it. Tested on its own.

import type { Chip, Lane } from "../board/chip";
import type { Meter, PlanFigures } from "../usage/meter";
import { planOf } from "../usage/meter";
import type { Plan } from "../usage/plan";

/** One agent pane as the window sees it: its chip (null before any signal) and meter. */
export type Seat = {
  key: number;
  agent: string;
  title: string;
  branch: string | null;
  cwd: string | null;
  account: string | null;
  chip: Chip | null;
  meter: Meter | null;
  /** When the state last moved; 0 when unknown. */
  since: number;
};

/** A row of the tower: the seat plus its lane and words; `jump` is the pane key to open. */
export type Row = Omit<Seat, "chip"> & { lane: Lane; word: string; line: string; file?: string; answer: boolean; jump: number };

/** Needs-you rows first, then working, then done; stopped and idle close the list (OD-09). */
export const ORDER: Lane[] = ["needs", "working", "done", "stopped", "idle"];

/** Rows in tower order; within a lane the newest change sits first. */
export function towerRows(seats: Seat[]): Row[] {
  const rank = (l: Lane) => ORDER.indexOf(l);
  const rows = seats.map(({ chip, ...s }): Row => ({ ...s, lane: chip?.lane ?? "idle", word: chip?.word ?? "Idle", line: chip?.line ?? "", file: chip?.file, answer: chip?.answer ?? false, jump: s.key }));
  return rows.sort((a, b) => rank(a.lane) - rank(b.lane) || b.since - a.since || a.key - b.key);
}

/** How many rows sit in each lane, in tower order. */
export function laneCounts(rows: Row[]): Array<{ lane: Lane; count: number }> {
  return ORDER.map((lane) => ({ lane, count: rows.filter((r) => r.lane === lane).length }));
}

/** One usage figure set per account in use: the provider's plan figures and how many panes run under it. */
export type AccountUsage = { agent: string; account: string | null; figures: PlanFigures | null; panes: number };

/** Accounts in the order their panes appear; every provider seat counts, even those with no figures yet.
 *  ponytail: src/usage holds one Claude figure set and one Codex set (the active account's), so every
 *  account of a provider shows the same figures until T-548 reads one set per account. */
export function usageByAccount(seats: Pick<Seat, "agent" | "account">[], plan: Plan): AccountUsage[] {
  const out: AccountUsage[] = [];
  for (const s of seats) {
    if (s.agent !== "claude" && s.agent !== "codex") continue;
    const account = s.account ?? null;
    const hit = out.find((u) => u.agent === s.agent && u.account === account);
    if (hit) hit.panes += 1;
    else out.push({ agent: s.agent, account, figures: planOf(s.agent, plan.claude, plan.codex), panes: 1 });
  }
  return out;
}
