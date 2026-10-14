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

/** One usage card per provider in use: its plan figures once, how many panes run under it, and the
 *  accounts those panes are on (in the order their panes appear) with a pane count each. */
export type AccountUsage = { agent: string; figures: PlanFigures | null; panes: number; accounts: Array<{ account: string | null; panes: number }> };

/** Providers in the order their panes appear; every provider seat counts, even before figures arrive.
 *  T-546-b (2): src/usage holds ONE Claude figure set and ONE Codex set (whichever account reported
 *  last), so a card per account would show the same figures under different names, a wrong number on
 *  the screen used to decide where work goes. Until T-548 reads one set per account, the figures sit
 *  on one card per provider and the accounts are listed under it with their pane counts. The name
 *  stays `usageByAccount` because the T-546 wiring in App.tsx imports it by that name. */
export function usageByAccount(seats: Pick<Seat, "agent" | "account">[], plan: Plan): AccountUsage[] {
  const out: AccountUsage[] = [];
  for (const s of seats) {
    if (s.agent !== "claude" && s.agent !== "codex") continue;
    const account = s.account ?? null;
    let card = out.find((u) => u.agent === s.agent);
    if (!card) out.push((card = { agent: s.agent, figures: planOf(s.agent, plan.claude, plan.codex), panes: 0, accounts: [] }));
    card.panes += 1;
    const acct = card.accounts.find((a) => a.account === account);
    if (acct) acct.panes += 1;
    else card.accounts.push({ account, panes: 1 });
  }
  return out;
}
