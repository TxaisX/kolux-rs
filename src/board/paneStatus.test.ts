// T-608 (brief "Path to an A", Phase 0): the Board, the Tower, the Inbox, the needs strip and the bell read
// one status per pane, the title guess included, so they never disagree. Each surface is built here the way
// the window builds it (evidence/product-ux-App.patch): the Board and the Tower from chipOf, the Inbox from
// sourceOf and inboxItems, the strip from waitingInGrid and the bell from needsYouCount over needsYou, all
// over the one paneStatus.
import { expect, test } from "vitest";
import { chipOf, needsYou, paneAgent, paneStatus, type Lane } from "./chip";
import { IDLE, reduceIdentity, type Identity } from "../terminal/shellMarks";
import type { Agent } from "../chrome/VendorMark";
import { towerRows } from "../tower/tower";
import { inboxItems, sourceOf, type Group } from "../inbox/inbox";
import type { AgentState } from "../projects/rows";
import { waitingInGrid } from "../terminal/tabs";
import { needsYouCount } from "../terminal/status";

const now = 1_000_000;
type Case = { agent?: string; live?: Identity; hook?: AgentState; guess?: AgentState | null; running: boolean | undefined };

/** One pane drawn on all five surfaces from the same signals (the Tower lists agent panes only, App.tsx towerNow). */
function surfaces(c: Case) {
  // The window reads the agent a pane shows (App.tsx agentOf): a plain terminal's live program counts.
  const agent = paneAgent({ agent: (c.agent ?? "claude") as Agent, program: null }, c.live);
  const state = paneStatus(agent, c.hook, c.guess, c.running);
  const chip = chipOf({ agent, state, running: c.running, stale: false, since: now - 60_000 }, now);
  const board: Lane = chip?.lane ?? "idle";
  const tower = agent === "shell" ? "idle" : towerRows([{ key: 1, agent, title: "Claude 1", branch: null, cwd: null, account: null, chip, meter: null, since: now - 60_000 }])[0].lane;
  const inboxRow = inboxItems([sourceOf({ key: 1, agent, branch: null, cwd: null }, "Claude 1", state, c.running, { at: now - 60_000, interrupted: false })], now)[0];
  const inbox: Group | null = inboxRow?.group ?? null;
  const strip = waitingInGrid([1], { 1: state }).length === 1;
  const bell = needsYouCount([1], new Set(needsYou(state) ? [1] : []));
  return { board, tower, inbox, strip, bell };
}

/** What needs you, said the same way by every surface. */
const needs = (s: ReturnType<typeof surfaces>) => [s.board === "needs", s.tower === "needs", s.inbox === "needs", s.strip, s.bell === 1];

test("T-608: a permission or a question needs you on all five surfaces", () => {
  for (const hook of ["permission", "waiting"] as const) expect(needs(surfaces({ hook, running: true }))).toEqual([true, true, true, true, true]);
});

test("T-608: the title guess feeds the same state: a guessed permission needs you on all five, not only on the bell", () => {
  expect(needs(surfaces({ guess: "permission", running: true }))).toEqual([true, true, true, true, true]);
});

test("T-608: the hook's word wins over the title guess everywhere", () => {
  const s = surfaces({ hook: "working", guess: "permission", running: true });
  expect(needs(s)).toEqual([false, false, false, false, false]);
  expect([s.board, s.tower, s.inbox]).toEqual(["working", "working", "waiting"]);
});

test("T-608: a stop (blocked, interrupted) is Stopped on the Board and Tower and needs you nowhere, the Inbox and the bell included", () => {
  for (const hook of ["blocked", "interrupted"] as const) {
    const s = surfaces({ hook, running: true });
    expect([s.board, s.tower]).toEqual(["stopped", "stopped"]);
    expect(needs(s)).toEqual([false, false, false, false, false]);
    expect(s.inbox).toBeNull();
  }
});

test("T-608: a guessed done or working puts the card in the lane the Inbox groups it under", () => {
  const done = surfaces({ guess: "done", running: true });
  expect([done.board, done.tower, done.inbox]).toEqual(["done", "done", "done"]);
  const working = surfaces({ guess: "working", running: true });
  expect([working.board, working.tower, working.inbox]).toEqual(["working", "working", "waiting"]);
});

test("T-608: a title guess counts only while the program runs: starting or ended, nothing needs you anywhere", () => {
  for (const running of [undefined, false]) expect(needs(surfaces({ guess: "permission", running }))).toEqual([false, false, false, false, false]);
  expect(surfaces({ guess: "permission", running: undefined }).board).toBe("working"); // Starting
  expect(surfaces({ guess: "permission", running: false }).board).toBe("stopped");
});

test("T-608: a plain terminal with nothing running in it has no status on any of the five, whatever a hook or its title said last", () => {
  for (const hook of [undefined, "permission", "waiting", "done"] as const)
    for (const guess of [null, "permission"] as const) {
      const s = surfaces({ agent: "shell", hook, guess, running: true });
      expect(needs(s), `${hook}/${guess}`).toEqual([false, false, false, false, false]);
      expect([s.board, s.inbox], `${hook}/${guess}`).toEqual(["idle", null]);
    }
});

test("T-608: every live state reads one way on every surface (the Board and the Tower show the same lane; the Inbox groups it to match)", () => {
  const inboxOf: Record<Lane, Group | null> = { needs: "needs", working: "waiting", done: "done", stopped: null, idle: null };
  const states: Array<AgentState | undefined> = [undefined, "permission", "blocked", "waiting", "interrupted", "working", "queued", "done", "idle"];
  for (const hook of states)
    for (const guess of [null, "permission", "working", "done"] as const) {
      const s = surfaces({ hook, guess, running: true });
      expect(s.tower, `${hook}/${guess}`).toBe(s.board);
      expect(s.inbox, `${hook}/${guess}`).toBe(inboxOf[s.board]);
      expect(new Set(needs(s)).size, `${hook}/${guess}`).toBe(1);
    }
});

test("T-608 (ACCT-050, DT-C11): an agent started by hand in a plain terminal is credited: its permission needs you on all five, and back at the prompt on none", () => {
  const claude = reduceIdentity(reduceIdentity(IDLE, { kind: "start" }), { kind: "title", text: "✳ Claude Code" });
  expect(claude.agent).toBe("claude");
  const asking = surfaces({ agent: "shell", live: claude, hook: "permission", running: true });
  expect(needs(asking)).toEqual([true, true, true, true, true]);
  const back = reduceIdentity(claude, { kind: "end", code: 0 });
  expect(needs(surfaces({ agent: "shell", live: back, hook: "permission", running: true }))).toEqual([false, false, false, false, false]);
});
