import { describe, expect, it } from "vitest";
import { laneCounts, selectionForKey, towerRows, usageByAccount, type Seat } from "./tower";
import type { Chip } from "../board/chip";

const chip = (lane: Chip["lane"], word: string = lane, line = "", file?: string): Chip => ({ lane, word, line, file, answer: lane === "needs" });
const seat = (key: number, chip: Chip | null, since = 0, extra: Partial<Seat> = {}): Seat => ({ key, agent: "claude", title: `pane ${key}`, branch: null, cwd: null, account: null, chip, meter: null, since, ...extra });

describe("towerRows", () => {
  it("orders needs-you first, then working, then done, then stopped and idle", () => {
    const rows = towerRows([seat(1, chip("done")), seat(2, chip("idle")), seat(3, chip("working")), seat(4, chip("stopped")), seat(5, chip("needs"))]);
    expect(rows.map((r) => r.lane)).toEqual(["needs", "working", "done", "stopped", "idle"]);
  });

  it("puts the newest change first inside a lane and keeps the pane order for ties", () => {
    const rows = towerRows([seat(1, chip("working"), 10), seat(2, chip("working"), 30), seat(3, chip("working"), 30), seat(4, chip("working"), 20)]);
    expect(rows.map((r) => r.key)).toEqual([2, 3, 4, 1]);
  });

  it("carries the chip's words and file and jumps to the pane's own key", () => {
    const [row] = towerRows([seat(7, chip("needs", "Needs you", "Bash: npm test"), 5, { title: "fix tests", branch: "agent-a" })]);
    expect(row).toMatchObject({ key: 7, jump: 7, lane: "needs", word: "Needs you", line: "Bash: npm test", answer: true, title: "fix tests", branch: "agent-a" });
    const [done] = towerRows([seat(8, chip("done", "Done", "handed off", "src/a.ts"))]);
    expect(done.file).toBe("src/a.ts");
  });

  it("reads a pane with no signal yet as idle", () => {
    expect(towerRows([seat(1, null)])[0]).toMatchObject({ lane: "idle", word: "Idle", line: "", answer: false });
  });

  it("counts every lane in tower order", () => {
    const rows = towerRows([seat(1, chip("needs")), seat(2, chip("needs")), seat(3, chip("working"))]);
    expect(laneCounts(rows)).toEqual([
      { lane: "needs", count: 2 },
      { lane: "working", count: 1 },
      { lane: "done", count: 0 },
      { lane: "stopped", count: 0 },
      { lane: "idle", count: 0 },
    ]);
  });
});

describe("usageByAccount", () => {
  const plan = {
    claude: [
      { kind: "five_hour", usedPercent: 42, resetsAt: null },
      { kind: "seven_day", usedPercent: 17, resetsAt: null },
    ],
    codex: { state: "ok" as const, fiveHour: { usedPercent: 5, resetsAt: null, windowMins: 300 }, weekly: { usedPercent: 60, resetsAt: null, windowMins: null }, resetCredits: null, plan: null, message: null },
  };

  // T-546-b (2): src/usage holds ONE figure set per provider, so two Claude accounts never get two
  // cards carrying the same figures under different names; one card per provider lists the accounts.
  it("gives one card per provider with its figures once and the pane count per account under it", () => {
    const seats = [
      { agent: "claude", account: "work" },
      { agent: "claude", account: "personal" },
      { agent: "claude", account: "work" },
      { agent: "claude", account: null },
      { agent: "codex", account: null },
      { agent: "shell", account: null },
    ];
    expect(usageByAccount(seats, plan)).toEqual([
      { agent: "claude", figures: { fiveHour: 42, weekly: 17 }, panes: 4, accounts: [{ account: "work", panes: 2 }, { account: "personal", panes: 1 }, { account: null, panes: 1 }] },
      { agent: "codex", figures: { fiveHour: 5, weekly: 60 }, panes: 1, accounts: [{ account: null, panes: 1 }] },
    ]);
  });

  it("never repeats a provider's figures: two Claude accounts share one card", () => {
    const cards = usageByAccount([{ agent: "claude", account: "work" }, { agent: "claude", account: "personal" }], plan);
    expect(cards).toHaveLength(1);
    expect(cards[0].accounts.map((a) => a.account)).toEqual(["work", "personal"]);
    expect(cards.filter((c) => c.figures?.fiveHour === 42)).toHaveLength(1);
  });

  it("keeps a provider whose figures have not arrived, with null figures", () => {
    expect(usageByAccount([{ agent: "codex", account: "b" }], { claude: [], codex: null })).toEqual([{ agent: "codex", figures: null, panes: 1, accounts: [{ account: "b", panes: 1 }] }]);
  });
});

// FIX-5 (council P2 P12): the list's keys: Up and Down walk, Home and End jump to the ends, any other key is left alone.
describe("FIX-5 the Tower list keys", () => {
  const keys = [4, 7, 9];
  it("walks with the arrows, stopping at the ends", () => {
    expect(selectionForKey("ArrowDown", keys, 4)).toEqual({ to: 7 });
    expect(selectionForKey("ArrowDown", keys, 9)).toEqual({ to: 9 });
    expect(selectionForKey("ArrowUp", keys, 7)).toEqual({ to: 4 });
    expect(selectionForKey("ArrowDown", keys, null)).toEqual({ to: 4 });
  });

  it("Home goes to the first row and End to the last, from anywhere", () => {
    expect(selectionForKey("Home", keys, 7)).toEqual({ to: 4 });
    expect(selectionForKey("End", keys, null)).toEqual({ to: 9 });
    expect(selectionForKey("End", [], null)).toEqual({ to: null });
  });

  it("leaves every other key to the page", () => {
    expect(selectionForKey("a", keys, 4)).toBeNull();
    expect(selectionForKey("Enter", keys, 4)).toBeNull();
  });
});
